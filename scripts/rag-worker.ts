import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../lib/prisma';
import { processNextDocument } from '../lib/rag/ingestion';
import { ragConfig } from '../lib/rag/config';
import { kafkaEnabled } from '../lib/rag/search/config';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
async function main() {
  if (kafkaEnabled()) { await (await import('../lib/rag/messaging/worker')).runKafkaWorker(controller.signal); return; }
  console.log(`RAG worker started (jobs=${ragConfig.workerConcurrency}, embedding=${ragConfig.embeddingConcurrency}, rpm=${ragConfig.embeddingRpm})`);
  await prisma.embeddingCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const maintenance = setInterval(() => { void prisma.embeddingCache.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => console.error('RAG cache maintenance temporarily unavailable')); }, 3600000);
  maintenance.unref();
  try { await Promise.all(Array.from({ length: process.argv.includes('--once') ? 1 : ragConfig.workerConcurrency }, () => consume())); }
  finally { clearInterval(maintenance); }
}
async function consume() {
  while (!controller.signal.aborted) {
    try {
      const processed = await processNextDocument(controller.signal);
      if (process.argv.includes('--once')) break;
      if (!processed) await delay(1500, undefined, { signal: controller.signal });
    } catch {
      if (controller.signal.aborted) break;
      console.error('RAG worker: database temporarily unavailable; retrying');
      await delay(5000, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
}
void main().finally(() => prisma.$disconnect());
