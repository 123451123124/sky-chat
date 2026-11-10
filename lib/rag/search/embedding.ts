import { prisma } from '../../prisma';
import { newEmbeddingStats, requestEmbeddingBatch, textHash, vectorLiteral } from '../embedding';
import { ragConfig } from '../config';
import { SEARCH_DIMENSIONS, searchEmbeddingProfile } from './config';

const memory = new Map<string, { bytes: Buffer; expires: number }>();
export function encodeSearchVector(vector: number[]): Buffer {
  vectorLiteral(vector, SEARCH_DIMENSIONS);
  const bytes = Buffer.allocUnsafe(SEARCH_DIMENSIONS * 4);
  vector.forEach((n, i) => bytes.writeFloatBE(n, i * 4));
  return bytes;
}
export function decodeSearchVector(bytes: Uint8Array): number[] {
  if (bytes.byteLength !== SEARCH_DIMENSIONS * 4) throw new Error('2048 维缓存格式错误');
  const buffer = Buffer.from(bytes); const vector = Array.from({ length: SEARCH_DIMENSIONS }, (_, i) => buffer.readFloatBE(i * 4));
  vectorLiteral(vector, SEARCH_DIMENSIONS); return vector;
}
export function clearSearchMemory(userId: string) { for (const key of memory.keys()) if (key.startsWith(`${userId}:`)) memory.delete(key); }
function remember(key: string, bytes: Buffer) {
  memory.delete(key); memory.set(key, { bytes, expires: Date.now() + 600000 });
  while (memory.size > 1024) memory.delete(memory.keys().next().value!);
}
export async function embedSearchTexts(userId: string, texts: string[], signal?: AbortSignal, stats = newEmbeddingStats()): Promise<number[][]> {
  const start = Date.now(); signal?.throwIfAborted(); stats.texts += texts.length;
  if (!texts.length) return [];
  const unique = new Map(texts.map((text) => [textHash(text), text.normalize('NFC').trim()])); stats.unique += unique.size;
  const vectors = new Map<string, number[]>(); const key = (hash: string) => `${userId}:${searchEmbeddingProfile}:${hash}`;
  for (const hash of unique.keys()) {
    const saved = memory.get(key(hash));
    if (saved && saved.expires > Date.now()) { vectors.set(hash, decodeSearchVector(saved.bytes)); memory.delete(key(hash)); memory.set(key(hash), saved); stats.memoryHits++; }
    else if (saved) memory.delete(key(hash));
  }
  const absent = [...unique.keys()].filter((hash) => !vectors.has(hash));
  const rows = absent.length ? await prisma.ragVectorCache.findMany({ where: { userId, profile: searchEmbeddingProfile, hash: { in: absent }, expiresAt: { gt: new Date() } } }) : [];
  for (const row of rows) { vectors.set(row.hash, decodeSearchVector(row.vector)); remember(key(row.hash), Buffer.from(row.vector)); }
  stats.databaseHits += rows.length; stats.cacheHits += vectors.size;
  const missing = [...unique.entries()].filter(([hash]) => !vectors.has(hash));
  const batchCount=Math.ceil(missing.length/ragConfig.embeddingBatchSize);
  let nextBatch=0,stopped=false;
  const work = Array.from({ length: Math.min(batchCount,ragConfig.embeddingConcurrency) }, async () => {
   while(!stopped&&nextBatch<batchCount){
    const index=nextBatch++;
    try{
    const items = missing.slice(index * ragConfig.embeddingBatchSize, (index + 1) * ragConfig.embeddingBatchSize);
    const embeddings = await requestEmbeddingBatch(items.map(([, text]) => text), signal, stats, SEARCH_DIMENSIONS);
    signal?.throwIfAborted();
    const records = items.map(([hash], i) => ({ userId, profile: searchEmbeddingProfile, hash, vector: encodeSearchVector(embeddings[i]), expiresAt: new Date(Date.now() + 30 * 86400000) }));
    await prisma.$transaction(async (tx) => {
      await tx.ragVectorCache.deleteMany({ where: { userId, profile: searchEmbeddingProfile, hash: { in: items.map(([hash]) => hash) }, expiresAt: { lte: new Date() } } });
      await tx.ragVectorCache.createMany({ data: records, skipDuplicates: true });
    });
    records.forEach((row, i) => { vectors.set(row.hash, embeddings[i]); remember(key(row.hash), row.vector); });
    }catch(error){stopped=true;throw error;}
   }
  });
  const settled = await Promise.allSettled(work);
  const failure = settled.find((r) => r.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
  stats.durationMs += Date.now() - start;
  return texts.map((text) => vectors.get(textHash(text))!);
}
