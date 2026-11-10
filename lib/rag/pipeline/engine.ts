import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type RagGeneration } from '@prisma/client';
import { prisma } from '../../prisma';
import { parseIsolated } from './parse';
import { chunksSchema, readArtifact, sectionsSchema, vectorsSchema, writeArtifact } from './artifacts';
import { splitHierarchical } from '../splitting';
import { embedSearchTexts } from '../search/embedding';
import { newEmbeddingStats } from '../embedding';
import { elastic } from '../search/client';
import { esConfig } from '../search/config';
import {indexSearchBatch} from '../search/bulk';
import { deadTopic, nextEvent, stages, stageTopic, type PipelineEvent, type PipelineStage } from '../messaging/contracts';
import { ProviderError } from '../provider';
import { z } from 'zod';

class StaleTask extends Error {}
async function readStageArtifact<T>(generationId: string, stage: PipelineStage, schema: z.ZodType<T>) {
  const receipt = await prisma.ragStage.findUniqueOrThrow({ where: { generationId_stage: { generationId, stage } } });
  if (receipt.status !== 'completed' || !receipt.artifactToken) throw new Error('前置阶段尚未完成');
  return readArtifact(generationId,stage,schema,receipt.artifactToken);
}
function chunkId(generationId: string, ordinal: number) {
  const bytes = createHash('sha256').update(`${generationId}:${ordinal}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function classifyStageError(error: unknown) {
  const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const transient = ['P1001','P1002','P1017','P2024','P2028','P2034'].includes(code) || (error instanceof ProviderError && error.retryable) || status === 429 || status >= 500 || (error instanceof Error && ['TypeError', 'TimeoutError', 'AbortError', 'ConnectionError'].includes(error.name));
  return { transient, code: transient ? 'TRANSIENT_SERVICE' : 'INVALID_ARTIFACT', message: transient ? '服务暂不可用，将按策略重试；达到上限后可人工恢复' : '阶段处理失败，请检查文件格式、模型配置或索引服务后重试' };
}
async function fence(tx: Prisma.TransactionClient, event: PipelineEvent, token: string) {
  const docs = await tx.$queryRaw<Array<{ pendingGenerationId: string | null }>>`SELECT "pendingGenerationId" FROM "Document" WHERE id = ${event.documentId} FOR UPDATE`;
  if (docs[0]?.pendingGenerationId !== event.generationId) throw new StaleTask();
  const gen = await tx.ragGeneration.findUnique({ where: { id: event.generationId } });
  if (!gen || gen.epoch !== event.epoch || gen.stage !== event.stage || !['queued','processing'].includes(gen.status)) throw new StaleTask();
  const receipt = await tx.$queryRaw<Array<{ id: string; attempts: number }>>`SELECT id, attempts FROM "RagStage" WHERE "generationId" = ${event.generationId} AND stage = ${event.stage} AND "leaseToken" = ${token} AND status = 'running' AND "leaseUntil" > NOW() FOR UPDATE`;
  if (!receipt.length) throw new StaleTask();
  return { gen, receipt: receipt[0] };
}
async function claim(event: PipelineEvent) {
  return prisma.$transaction(async (tx) => {
    const docs = await tx.$queryRaw<Array<{ pendingGenerationId: string | null }>>`SELECT "pendingGenerationId" FROM "Document" WHERE id = ${event.documentId} FOR UPDATE`;
    const gen = await tx.ragGeneration.findUnique({ where: { id: event.generationId } });
    const sent = await tx.ragOutbox.findUnique({ where: { id: event.eventId } });
    if (!sent || sent.generationId !== event.generationId || JSON.stringify(sent.payload) !== JSON.stringify(event)) {
      // JSONB key ordering can differ; validate field values instead of trusting broker payloads.
      if (!sent || sent.generationId !== event.generationId || Object.entries(event).some(([key,value]) => (sent.payload as Record<string, unknown>)[key] !== value)) throw new StaleTask();
    }
    if (!gen || docs[0]?.pendingGenerationId !== event.generationId || gen.documentId !== event.documentId || gen.profile !== event.profile || gen.epoch !== event.epoch || gen.stage !== event.stage || !['queued','processing'].includes(gen.status)) return null;
    const receipt = await tx.ragStage.findUniqueOrThrow({ where: { generationId_stage: { generationId: gen.id, stage: event.stage } } });
    if (receipt.status === 'completed' || receipt.status === 'dead') return null;
    if (receipt.status === 'running' && receipt.leaseUntil && receipt.leaseUntil > new Date()) return 'busy' as const;
    const token = randomUUID();
    await tx.ragStage.update({ where: { id: receipt.id }, data: { status: 'running', leaseToken: token, leaseUntil: new Date(Date.now() + 60000), attempts: { increment: 1 }, lastError: null } });
    await tx.ragGeneration.update({ where: { id: gen.id }, data: { status: 'processing' } });
    return { generation: gen, token };
  });
}
async function stageWork(event: PipelineEvent, generation: RagGeneration, token: string, signal: AbortSignal) {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: event.documentId } });
  const started = Date.now(); const stats = newEmbeddingStats(); let counts: Record<string, number> = {};
  if (event.stage === 'parse') {
    const checkpoint = await prisma.ingestionCheckpoint.findUnique({ where: { documentId: doc.id } });
    const profile = `${doc.hash}:pdfjs5:v2`;
    const saved = checkpoint?.profile === profile ? sectionsSchema.safeParse(checkpoint.sections) : null;
    const sections = saved?.success ? saved.data : await parseIsolated(doc.id, doc.name, signal);
    signal.throwIfAborted(); await writeArtifact(generation.id, 'parse', sections,token);
    await prisma.$transaction(async (tx) => { await fence(tx,event,token); await tx.ingestionCheckpoint.upsert({ where: { documentId: doc.id }, create: { documentId: doc.id, profile, sections }, update: { profile, sections } }); });
    counts = { checkpointReused: saved?.success ? 1 : 0, sections: sections.length };
  } else if (event.stage === 'chunk') {
    const sections = await readStageArtifact(generation.id, 'parse', sectionsSchema);
    const chunks = await splitHierarchical(sections, generation.strategy, doc.userId, signal, stats, embedSearchTexts);
    if (!chunks.length) throw new Error('没有可检索文本');
    signal.throwIfAborted(); await writeArtifact(generation.id, 'chunk', chunks,token);
    counts = { parents: chunks.filter((c) => c.kind === 'parent').length, leaves: chunks.filter((c) => c.kind === 'leaf').length };
  } else if (event.stage === 'embed') {
    const chunks = await readStageArtifact(generation.id, 'chunk', chunksSchema);
    const leaves = chunks.filter((c) => c.kind === 'leaf');
    const vectors = await embedSearchTexts(doc.userId, leaves.map((c) => `${c.heading ? c.heading+'\n' : ''}${c.text}`), signal, stats);
    signal.throwIfAborted(); await writeArtifact(generation.id, 'embed', vectors,token);
    counts = { vectors: vectors.length };
  } else {
    const chunks = await readStageArtifact(generation.id, 'chunk', chunksSchema);
    const vectors = await readStageArtifact(generation.id, 'embed', vectorsSchema);
    const ids = chunks.map((_, i) => chunkId(generation.id, i));
    const leaves = chunks.map((chunk, ordinal) => ({ chunk, ordinal })).filter(({ chunk }) => chunk.kind === 'leaf');
    if (leaves.length !== vectors.length) throw new Error('向量数量和分块不一致');
    await prisma.$transaction(async (tx) => {
      await fence(tx, event, token);
      // Stable IDs and skipDuplicates preserve existing citations when an index event is delivered again.
      for (const kind of ['parent','leaf']) {
        const records = chunks.flatMap((c, i) => c.kind === kind ? [{ id: ids[i], documentId: doc.id, generationId: generation.id, ordinal: i, text: c.text, page: c.page, heading: c.heading, kind: c.kind, parentId: c.parentIndex === null ? null : ids[c.parentIndex] }] : []);
        for (let i=0;i<records.length;i+=100) await tx.chunk.createMany({ data: records.slice(i,i+100), skipDuplicates: true });
      }
    }, { timeout: 45000 });
    for (let offset=0;offset<leaves.length;offset+=50) {
      signal.throwIfAborted(); const items = leaves.slice(offset,offset+50);
      const batch = items.map(({chunk,ordinal},i) => ({ id: ids[ordinal], document: { documentId: doc.id, generationId: generation.id, profile: generation.profile, ownerId: doc.userId, knowledgeBaseId: doc.knowledgeBaseId || '', parentId: chunk.parentIndex === null ? '' : ids[chunk.parentIndex], tags: doc.tags, identifiers:[...new Set((chunk.text.match(/[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+/gi)||[]).map((s)=>s.toLowerCase()))], text: chunk.text, heading: chunk.heading || '', name: doc.name, embedding: vectors[offset+i] } }));
      await indexSearchBatch(batch,signal);
    }
    await elastic().indices.refresh({ index: esConfig.index }, { signal });
    counts = { indexedLeaves: leaves.length };
  }
  return { durationMs: Date.now()-started, ...counts, embedding: stats };
}
async function complete(event: PipelineEvent, token: string, metric: Awaited<ReturnType<typeof stageWork>>) {
  await prisma.$transaction(async (tx) => {
    const { gen, receipt } = await fence(tx,event,token);
    const doc = await tx.document.findUniqueOrThrow({ where: { id: event.documentId } });
    const metrics = { ...(gen.metrics as Record<string, unknown>), [event.stage]: metric } as Prisma.InputJsonObject;
    const ordinal = stages.indexOf(event.stage); const progress = [15,35,80,100][ordinal];
    await tx.ragStage.update({ where: { id: receipt.id }, data: { status: 'completed', artifactToken: token, leaseToken: null, leaseUntil: null, durationMs: metric.durationMs, completedAt: new Date() } });
    if (ordinal < stages.length-1) {
      const stage = stages[ordinal+1]; const next = nextEvent(event,stage);
      await tx.ragStage.upsert({ where: { generationId_stage: { generationId: gen.id, stage } }, create: { generationId: gen.id, stage }, update: {} });
      await tx.ragOutbox.create({ data: { id: next.eventId, generationId: gen.id, topic: stageTopic(stage), key: doc.familyId, payload: next } });
      await tx.ragGeneration.update({ where: { id: gen.id }, data: { stage, metrics, progress } });
      if (!doc.activeGenerationId && doc.status !== 'ready') await tx.document.update({ where: { id: doc.id }, data: { status: stage === 'embed' || stage === 'index' ? 'embedding' : 'parsing', progress } });
    } else {
      if (doc.replacesId && !doc.isCurrent) {
        const previous = await tx.document.findFirst({ where: { id: doc.replacesId, familyId: doc.familyId, isCurrent: true } });
        if (!previous) throw new StaleTask();
        await tx.document.update({ where: { id: previous.id }, data: { isCurrent: false } });
        await tx.$executeRaw`INSERT INTO "SessionDocument" ("sessionId","documentId") SELECT "sessionId", ${doc.id} FROM "SessionDocument" WHERE "documentId" = ${previous.id} ON CONFLICT DO NOTHING`;
        await tx.sessionDocument.deleteMany({ where: { documentId: previous.id } });
      }
      await tx.ragGeneration.update({ where: { id: gen.id }, data: { status: 'ready', metrics, progress: 100, error: null } });
      const summary = { ...metrics, embedding: (metrics.embed as Prisma.InputJsonObject)?.embedding || {}, checkpointReused: !!(metrics.parse as Prisma.InputJsonObject)?.checkpointReused, totalMs: Object.values(metrics).reduce<number>((sum,m)=>sum+Number((m as Prisma.InputJsonObject)?.durationMs||0),0) };
      await tx.document.update({ where: { id: doc.id }, data: { activeGenerationId: gen.id, pendingGenerationId: null, status: 'ready', isCurrent: true, progress: 100, error: null, chunkCount: Number((metrics.chunk as Record<string, unknown>)?.leaves || 0), ingestionMetrics: summary } });
      await tx.ingestionJob.updateMany({ where: { documentId: doc.id }, data: { status: 'completed', attempts: receipt.attempts, errorCode: null, lastError: null } });
    }
  }, { timeout: 45000 });
}
async function fail(event: PipelineEvent, token: string, error: unknown) {
  const classified = classifyStageError(error);
  const detail = error as { name?: string; code?: string; statusCode?: number };
  console.error('RAG stage error',JSON.stringify({stage:event.stage,name:detail?.name,code:detail?.code,status:detail?.statusCode}));
  await prisma.$transaction(async (tx) => {
    const { gen, receipt } = await fence(tx,event,token);
    const doc = await tx.document.findUniqueOrThrow({ where: { id: event.documentId } });
    const retry = classified.transient && receipt.attempts < 3;
    await tx.ragStage.update({ where: { id: receipt.id }, data: { status: retry ? 'pending' : 'dead', leaseToken: null, leaseUntil: null, errorCode: classified.code, lastError: classified.message } });
    if (retry) {
      const next = nextEvent(event,event.stage);
      await tx.ragOutbox.create({ data: { id: next.eventId, generationId: gen.id, topic: stageTopic(event.stage), key: doc.familyId, payload: next, availableAt: new Date(Date.now()+Math.min(60000,1000*2**receipt.attempts)) } });
      await tx.ragGeneration.update({ where: { id: gen.id }, data: { status: 'queued', error: classified.message } });
    } else {
      const record = await tx.ragDeadLetter.upsert({ where: { eventId: event.eventId }, create: { generationId: gen.id, eventId: event.eventId, stage: event.stage, payload: event, errorCode: classified.code, message: classified.message, attempts: receipt.attempts }, update: {} });
      await tx.ragOutbox.create({ data: { generationId: gen.id, topic: deadTopic, key: doc.familyId, payload: { deadLetterId: record.id, ...event, errorCode: classified.code } } });
      await tx.ragGeneration.update({ where: { id: gen.id }, data: { status: 'failed', error: classified.message } });
      if (!doc.activeGenerationId && doc.status !== 'ready') await tx.document.update({ where: { id: doc.id }, data: { status: 'failed', error: classified.message } });
      await tx.ingestionJob.updateMany({ where: { documentId: doc.id }, data: { status: 'dead', attempts: receipt.attempts, errorCode: classified.code, lastError: classified.message } });
    }
  });
}
export async function processPipelineEvent(event: PipelineEvent, signal: AbortSignal) {
  let claimed: Awaited<ReturnType<typeof claim>>;
  try { claimed = await claim(event); } catch (error) { if (error instanceof StaleTask) return 'ignored'; throw error; }
  if (!claimed) return 'ignored'; if (claimed === 'busy') return 'busy';
  const { generation, token } = claimed; const controller = new AbortController();
  const combined = AbortSignal.any([signal,controller.signal,AbortSignal.timeout(240000)]);
  const heartbeat = setInterval(() => { void prisma.ragStage.updateMany({ where: { generationId: generation.id, stage: event.stage, leaseToken: token, status: 'running' }, data: { leaseUntil: new Date(Date.now()+60000) } }).then((r) => { if (!r.count) controller.abort(); }).catch(() => controller.abort()); },10000);
  try { const metric = await stageWork(event,generation,token,combined); combined.throwIfAborted(); await complete(event,token,metric); return 'completed'; }
  catch (error) { if (error instanceof StaleTask) return 'ignored'; try { await fail(event,token,error); } catch (failure) { if (!(failure instanceof StaleTask)) throw failure; } return 'failed'; }
  finally { clearInterval(heartbeat); }
}
export async function replayDeadLetter(tx: Prisma.TransactionClient, id: string, userId: string) {
  const letter = await tx.ragDeadLetter.findFirst({ where: { id, generation: { document: { userId } } }, include: { generation: { include: { document: { include: { knowledgeBase: true } } } } } });
  if (!letter || letter.replayedAt) throw new Error('失败记录不可重放');
  const snapshot = letter.generation.document;
  if (snapshot.knowledgeBaseId) await tx.$queryRaw`SELECT id FROM "KnowledgeBase" WHERE id = ${snapshot.knowledgeBaseId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${snapshot.id} FOR UPDATE`;
  const doc = await tx.document.findUniqueOrThrow({where:{id:snapshot.id},include:{knowledgeBase:true}});
  if (doc.knowledgeBaseId !== snapshot.knowledgeBaseId) throw new Error('该版本的分组已变化，请刷新后重试');
  const freshLetter = await tx.ragDeadLetter.findUniqueOrThrow({where:{id},include:{generation:true}});
  if (freshLetter.replayedAt) throw new Error('失败记录已重放');
  if (doc.knowledgeBase?.published || doc.pendingGenerationId !== letter.generationId || freshLetter.generation.status !== 'failed') throw new Error('请先取消发布；仅能重放该文件最新的失败任务');
  if (doc.replacesId && !doc.isCurrent && !await tx.document.findFirst({ where: { id: doc.replacesId, isCurrent: true } })) throw new Error('该版本已被取代');
  const epoch = freshLetter.generation.epoch+1;
  const event = nextEvent({ ...(letter.payload as unknown as PipelineEvent), epoch },letter.stage as PipelineStage);
  await tx.ragGeneration.update({ where: { id: letter.generationId }, data: { epoch, status: 'queued', error: null } });
  await tx.ragStage.update({ where: { generationId_stage: { generationId: letter.generationId, stage: letter.stage } }, data: { status: 'pending', attempts: 0, leaseToken: null, leaseUntil: null } });
  await tx.ragDeadLetter.update({ where: { id }, data: { replayedAt: new Date() } });
  await tx.ragOutbox.create({ data: { id: event.eventId, generationId: event.generationId, topic: stageTopic(event.stage), key: doc.familyId, payload: event } });
  if (!doc.activeGenerationId) await tx.document.update({ where: { id: doc.id }, data: { status: 'queued', error: null } });
  return event;
}
