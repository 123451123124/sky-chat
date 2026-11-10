import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { kafka, consumerGroup, ensureTopics } from './client';
import { deadTopic, eventSchema, stages, stageTopic } from './contracts';
import { processPipelineEvent } from '../pipeline/engine';
import { elastic, ensureSearchIndex } from '../search/client';
import { esConfig } from '../search/config';
import { removeArtifacts } from '../pipeline/artifacts';
import type { Producer } from 'kafkajs';

export async function publishOutbox(producer: Producer) {
  const token = randomUUID();
  const rows = await prisma.$transaction(async (tx) => {
    const records = await tx.$queryRaw<Array<{ id: string; topic: string; key: string; payload: Prisma.JsonValue }>>`SELECT id, topic, key, payload FROM "RagOutbox" WHERE (status = 'queued' AND "availableAt" <= NOW()) OR (status = 'leased' AND "leaseUntil" < NOW()) ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 10`;
    if (records.length) await tx.ragOutbox.updateMany({ where: { id: { in: records.map((r) => r.id) } }, data: { status: 'leased', leaseToken: token, leaseUntil: new Date(Date.now()+60000), attempts: { increment: 1 } } });
    return records;
  });
  for (const row of rows) {
    try {
      await producer.send({ topic: row.topic, acks: -1, messages: [{ key: row.key, value: JSON.stringify(row.payload), headers: { eventId: row.id } }] });
      await prisma.ragOutbox.updateMany({ where: { id: row.id, leaseToken: token }, data: { status: 'sent', sentAt: new Date(), leaseToken: null, leaseUntil: null, lastError: null } });
    } catch {
      await prisma.ragOutbox.updateMany({ where: { id: row.id, leaseToken: token }, data: { status: 'queued', availableAt: new Date(Date.now()+5000), leaseToken: null, leaseUntil: null, lastError: '消息发布暂时失败，将重试' } });
    }
  }
  return rows.length;
}
export async function cleanupSearchArtifacts() {
  const rows = await prisma.ragIndexCleanup.findMany({ where: { availableAt: { lte: new Date() } }, take: 5 });
  for (const row of rows) {
    try {
      await elastic().deleteByQuery({ index: esConfig.index, query: { term: { generationId: row.generationId } }, conflicts: 'proceed', refresh: true });
      await removeArtifacts(row.generationId);
      await prisma.ragIndexCleanup.deleteMany({ where: { generationId: row.generationId } });
    } catch { await prisma.ragIndexCleanup.updateMany({ where: { generationId: row.generationId }, data: { attempts: { increment: 1 }, availableAt: new Date(Date.now()+60000) } }); }
  }
}
export async function runKafkaWorker(signal: AbortSignal) {
  const crash = new AbortController(); const combinedSignal = AbortSignal.any([signal,crash.signal]);
  await ensureSearchIndex(); await ensureTopics();
  const producer = kafka().producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
  await producer.connect();
  const consumers = stages.map((stage) => kafka().consumer({ groupId: consumerGroup(stage), sessionTimeout: 45000, heartbeatInterval: 3000, maxBytesPerPartition: 1024*1024, allowAutoTopicCreation: false }));
  try {
    for (let i=0;i<consumers.length;i++) {
      const consumer = consumers[i]; consumer.on(consumer.events.CRASH,({payload})=>{if(!payload.restart){console.error('RAG consumer stopped; restart required; durable records retained');crash.abort();}}); await consumer.connect(); await consumer.subscribe({ topic: stageTopic(stages[i]), fromBeginning: true });
      await consumer.run({ autoCommit: false, eachBatchAutoResolve: false, partitionsConsumedConcurrently: 2,
        eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
          for (const message of batch.messages) {
            if (!isRunning() || isStale() || combinedSignal.aborted) return;
            const controller = new AbortController();
            const pulse = setInterval(() => { void heartbeat().catch(() => controller.abort()); },5000);
            try {
              let parsed; try { parsed = eventSchema.safeParse(JSON.parse(message.value?.toString() || '{}')); } catch { parsed = null; }
              if (!parsed?.success || stageTopic(parsed.data.stage) !== batch.topic) {
                await producer.send({ topic: deadTopic, acks: -1, messages: [{ key: 'invalid-event', value: JSON.stringify({ errorCode: 'INVALID_EVENT', topic: batch.topic, partition: batch.partition, offset: message.offset }) }] });
              } else {
                const combined = AbortSignal.any([combinedSignal,controller.signal]);
                while (await processPipelineEvent(parsed.data,combined) === 'busy') { await heartbeat(); await delay(1000,undefined,{signal:combined}); }
              }
              if (!isRunning() || isStale() || combinedSignal.aborted || controller.signal.aborted) return;
              resolveOffset(message.offset);
              await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: (BigInt(message.offset)+BigInt(1)).toString() }]);
              await heartbeat();
            } finally { clearInterval(pulse); }
          }
        } });
    }
    console.log('Kafka RAG worker ready: parse / chunk / embed / index; outbox relay active');
    let maintenance = 0;
    while (!combinedSignal.aborted) {
      try {
        const published = await publishOutbox(producer);
        if (Date.now()-maintenance>60000) { await cleanupSearchArtifacts(); await prisma.ragVectorCache.deleteMany({where:{expiresAt:{lt:new Date()}}}); maintenance=Date.now(); }
        if (!published) await delay(750,undefined,{signal:combinedSignal});
      } catch { if (!combinedSignal.aborted) { console.error('RAG relay temporarily unavailable; durable records retained'); await delay(3000,undefined,{signal:combinedSignal}).catch(()=>{}); } }
    }
  } finally {
    await Promise.allSettled(consumers.map(async (c) => { await c.stop(); await c.disconnect(); }));
    await producer.disconnect();
  }
  if(crash.signal.aborted&&!signal.aborted)throw new Error('Kafka consumer stopped');
}
