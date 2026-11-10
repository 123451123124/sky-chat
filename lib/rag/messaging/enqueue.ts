import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generationProfile } from '../search/config';
import { nextEvent, stageTopic, type PipelineEvent } from './contracts';
import { RagError } from '../access';

export async function enqueueGeneration(tx: Prisma.TransactionClient, documentId: string) {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { knowledgeBase: true } });
  if (!doc.isCurrent && doc.status === 'ready') throw new RagError('历史版本不能重新启用，请在当前文件上上传新版本',409);
  if (!doc.isCurrent && doc.replacesId && !await tx.document.findFirst({where:{id:doc.replacesId,isCurrent:true}})) throw new RagError('该版本已被后续版本取代，请重新上传',409);
  if (doc.pendingGenerationId) {
    const pending = await tx.ragGeneration.findUnique({ where: { id: doc.pendingGenerationId } });
    if (pending && ['queued', 'processing'].includes(pending.status)) throw new RagError('该文件已有索引任务在处理中', 409);
  }
  const strategy = doc.knowledgeBase?.chunkingStrategy || 'recursive';
  const generation = await tx.ragGeneration.create({ data: { documentId, strategy, profile: generationProfile(strategy), stages: { create: { stage: 'parse' } } } });
  const event: PipelineEvent = nextEvent({ generationId: generation.id, documentId, epoch: 1, stage: 'parse', profile: generation.profile, traceId: randomUUID() }, 'parse');
  await tx.ragOutbox.create({ data: { id: event.eventId, generationId: generation.id, topic: stageTopic('parse'), key: doc.familyId, payload: event } });
  await tx.document.update({ where: { id: documentId }, data: { pendingGenerationId: generation.id, ...(!doc.activeGenerationId && doc.status !== 'ready' ? { status: 'queued', progress: 0, error: null } : {}) } });
  await tx.ingestionJob.upsert({ where: { documentId }, create: { documentId, status: 'external' }, update: { status: 'external', leasedBy: null, heartbeatAt: null } });
  return generation;
}
