import { parseDocument } from './parsing';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { embedCachedTexts, embeddingProfile, newEmbeddingStats, textHash, vectorLiteral } from './embedding';
import { splitHierarchical, pipelineProfile } from './splitting';
import { tokenize } from './tokenization';
import { ProviderError } from './provider';
import { z } from 'zod';

// A lease is recovered after worker crashes; a unique owner prevents stale commits.
export async function processNextDocument(signal: AbortSignal): Promise<boolean> {
  const lease = randomUUID();
  const jobs = await prisma.$queryRaw<Array<{ id: string; documentId: string; attempts: number }>>`
    UPDATE "IngestionJob" SET status = 'running', "leasedBy" = ${lease}, "heartbeatAt" = NOW(), "updatedAt" = NOW(), attempts = attempts + 1
    WHERE id = (SELECT id FROM "IngestionJob" WHERE (status = 'queued' AND "availableAt" <= NOW()) OR (status = 'running' AND "heartbeatAt" < NOW() - INTERVAL '5 minutes') ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, "documentId", attempts`;
  const job = jobs[0];
  if (!job) return false;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(240000)]);
  const heartbeat = setInterval(() => {
    void prisma.ingestionJob.updateMany({ where: { id: job.id, leasedBy: lease }, data: { heartbeatAt: new Date() } })
      .then((r) => { if (!r.count) controller.abort(); }).catch(() => controller.abort());
  }, 20000);
  const owned = { id: job.id, leasedBy: lease };
  const metrics: Record<string, unknown> = {};
  const started = Date.now();
  async function setStage(data: Prisma.DocumentUpdateInput) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${job.documentId} FOR UPDATE`;
      const active = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "IngestionJob" WHERE id = ${job.id} AND "leasedBy" = ${lease} AND status = 'running' FOR UPDATE`;
      if (!active.length) throw new Error('任务租约已过期');
      await tx.document.update({ where: { id: job.documentId }, data });
    });
  }
  try {
    const document = await prisma.document.findUnique({ where: { id: job.documentId }, include: { knowledgeBase: { select: { chunkingStrategy: true } }, checkpoint: true } });
    if (!document) return true;
    if (job.attempts > 3) throw new Error('后台任务多次中断，请检查服务后手动重试');
    await setStage({ status: 'parsing', progress: 5, error: null });
    const strategy = document.knowledgeBase?.chunkingStrategy || 'recursive';
    const profile = pipelineProfile(strategy);
    const checkpointKey = `${document.hash}:pdfjs5:v2`;
    const parseStart = Date.now();
    const saved = document.checkpoint?.profile === checkpointKey ? z.array(z.object({ text: z.string(), page: z.number().nullable(), heading: z.string().nullable() })).safeParse(document.checkpoint.sections) : null;
    const sections = saved?.success ? saved.data : await parseDocument(document.id, document.name, combined);
    metrics.parseMs = Date.now() - parseStart; metrics.checkpointReused = !!saved?.success;
    if (!saved?.success) await prisma.ingestionCheckpoint.upsert({ where: { documentId: document.id }, create: { documentId: document.id, profile: checkpointKey, sections: sections as unknown as Prisma.InputJsonValue }, update: { profile: checkpointKey, sections: sections as unknown as Prisma.InputJsonValue } });
    const stats = newEmbeddingStats(); const splitStart = Date.now();
    const chunks = await splitHierarchical(sections, strategy, document.userId, combined, stats);
    metrics.splitMs = Date.now() - splitStart;
    if (!chunks.length) throw new Error('没有可检索的文本；扫描件暂不支持 OCR');
    const leaves = chunks.filter((c) => c.kind === 'leaf');
    await setStage({ status: 'embedding', progress: 20, chunkCount: leaves.length });
    const vectors = await embedCachedTexts(document.userId, leaves.map((c) => `${c.heading ? c.heading + '\n' : ''}${c.text}`), combined, stats);
    metrics.embedding = stats; metrics.parents = chunks.length - leaves.length; metrics.leaves = leaves.length;
    combined.throwIfAborted(); const writeStart = Date.now();
    await setStage({ progress: 90 });
    await prisma.$transaction(async (tx) => {
      // Lock the document so deletion cannot race the atomic replacement.
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${document.id} FOR UPDATE`;
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "IngestionJob" WHERE id = ${job.id} AND "leasedBy" = ${lease} AND status = 'running' FOR UPDATE`;
      if (!active.length) throw new Error('任务已删除或租约已过期');
      combined.throwIfAborted();
      await tx.chunk.deleteMany({ where: { documentId: document.id } });
      const ids = chunks.map(() => randomUUID()); let leaf = 0;
      for (let i = 0; i < chunks.length; i += 50) {
        const values = chunks.slice(i, i + 50).map((c, j) => {
          const vector = c.kind === 'leaf' ? vectorLiteral(vectors[leaf++]) : null;
          return Prisma.sql`(${ids[i + j]}, ${document.id}, ${i + j}, ${c.text}, ${c.page}, ${c.heading}, ${vector}::vector, ${c.kind}, ${c.parentIndex === null ? null : ids[c.parentIndex]}, ${textHash(c.text)}, ${tokenize(`${document.name} ${c.heading || ''} ${c.text}`).join(' ')})`;
        });
        await tx.$executeRaw(Prisma.sql`INSERT INTO "Chunk" (id, "documentId", ordinal, text, page, heading, embedding, kind, "parentId", "textHash", "searchText") VALUES ${Prisma.join(values)}`);
      }
      if (document.replacesId) {
        const previous = await tx.document.findFirst({ where: { id: document.replacesId, userId: document.userId, familyId: document.familyId, isCurrent: true } });
        if (!previous) throw new Error('文档版本已变化');
        await tx.document.update({ where: { id: previous.id }, data: { isCurrent: false } });
        await tx.$executeRaw`INSERT INTO "SessionDocument" ("sessionId", "documentId") SELECT "sessionId", ${document.id} FROM "SessionDocument" WHERE "documentId" = ${previous.id} ON CONFLICT DO NOTHING`;
        await tx.sessionDocument.deleteMany({ where: { documentId: previous.id } });
      }
      metrics.writeMs = Date.now() - writeStart; metrics.totalMs = Date.now() - started;
      await tx.document.update({ where: { id: document.id }, data: { status: 'ready', isCurrent: true, progress: 100, error: null, chunkCount: leaves.length, embeddingModel: embeddingProfile, pipelineProfile: profile, ingestionMetrics: metrics as Prisma.InputJsonValue } });
      await tx.ingestionJob.update({ where: { id: job.id }, data: { status: 'completed', leasedBy: null, heartbeatAt: null, errorCode: null, lastError: null } });
    }, { timeout: 45000 });
  } catch (e) {
    // No raw provider/database errors or credentials are stored in a user-visible error.
    const transient = signal.aborted || (e instanceof ProviderError && e.retryable) || (e instanceof Error && ['TimeoutError', 'TypeError'].includes(e.name));
    const retry = transient && job.attempts < 3;
    const message = e instanceof Error && /^(PDF 超过|文档分块|没有可检索|向量服务|后台任务)/.test(e.message) ? e.message : transient ? '上游暂不可用，任务将按策略重试；达到上限后可手动恢复' : '文件处理失败，请确认文件为可读取的 PDF 或 UTF-8 文本后重试';
    await prisma.$transaction(async (tx) => {
      const updated = await tx.ingestionJob.updateMany({ where: owned, data: { status: retry ? 'queued' : 'dead', leasedBy: null, heartbeatAt: null, availableAt: new Date(Date.now() + 5000 * 2 ** job.attempts), errorCode: transient ? 'TRANSIENT_PROVIDER' : 'INVALID_DOCUMENT', lastError: message } });
      if (updated.count) await tx.document.updateMany({ where: { id: job.documentId }, data: { status: retry ? 'queued' : 'failed', error: message, ingestionMetrics: { ...metrics, totalMs: Date.now() - started } as Prisma.InputJsonValue } });
    }).catch(() => {});
  } finally { clearInterval(heartbeat); }
  return true;
}
