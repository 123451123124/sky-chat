import { createHash } from 'node:crypto';
import PQueue from 'p-queue';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ragConfig } from './config';
import { requestWithRetry } from './provider';

export const EMBEDDING_DIMENSIONS = 1024;
const model = process.env.EMBEDDING_MODEL || 'text-embedding-v4';
const base = (process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
export const embeddingProfile = `${base}/${model}:${EMBEDDING_DIMENSIONS}:v1`;

export function vectorLiteral(vector: number[], dimensions = EMBEDDING_DIMENSIONS): string {
  if (vector.length !== dimensions || vector.some((n) => !Number.isFinite(n)) || !vector.some((n) => n !== 0)) throw new Error('向量格式异常');
  return `[${vector.join(',')}]`;
}

const queue = new PQueue({ concurrency: ragConfig.embeddingConcurrency, intervalCap: ragConfig.embeddingRpm, interval: 60000, carryoverIntervalCount: true });
let successes = 0;
export interface EmbeddingStats { texts: number; unique: number; cacheHits: number; memoryHits: number; databaseHits: number; requests: number; retries: number; durationMs: number }
export const newEmbeddingStats = (): EmbeddingStats => ({ texts: 0, unique: 0, cacheHits: 0, memoryHits: 0, databaseHits: 0, requests: 0, retries: 0, durationMs: 0 });
export const textHash = (text: string) => createHash('sha256').update(text.normalize('NFC').trim()).digest('hex');
const memory = new Map<string, { vector: Float32Array; expires: number }>();
const memoryKey = (userId: string, hash: string) => `${userId}:${embeddingProfile}:${hash}`;
function remember(key: string, vector: number[]) {
  memory.delete(key); memory.set(key, { vector: Float32Array.from(vector), expires: Date.now() + 600000 });
  while (memory.size > 1024) memory.delete(memory.keys().next().value!);
}
export function clearEmbeddingMemoryCache(userId: string) { for (const key of memory.keys()) if (key.startsWith(`${userId}:`)) memory.delete(key); }
// pgvector's documented wire representation: int16 dimensions, int16 reserved, float32 BE elements.
export function decodeVectorBinary(encoded: string): number[] {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== 4 + EMBEDDING_DIMENSIONS * 4 || bytes.readUInt16BE(0) !== EMBEDDING_DIMENSIONS || bytes.readUInt16BE(2) !== 0) throw new Error('缓存向量格式异常');
  const result = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => bytes.readFloatBE(4 + i * 4)); vectorLiteral(result); return result;
}

export async function requestEmbeddingBatch(texts: string[], signal?: AbortSignal, stats?: EmbeddingStats, dimensions = EMBEDDING_DIMENSIONS): Promise<number[][]> {
  const key = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('未配置向量服务密钥');
  const response = await requestWithRetry(() => queue.add(async () => {
    signal?.throwIfAborted(); if (stats) stats.requests++;
    return fetch(`${base}/embeddings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts, dimensions, encoding_format: 'float' }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]),
    });
  }, { signal, priority: texts.length === 1 ? 1 : 0 }) as Promise<Response>, signal, (status) => {
    if (stats) stats.retries++;
    if (status === 429) { queue.concurrency = Math.max(1, Math.floor(queue.concurrency / 2)); successes = 0; }
  });
  const json = await response.json();
  if (!Array.isArray(json.data) || json.data.length !== texts.length) throw new Error('向量服务返回数量异常');
  const ordered = [...json.data].sort((a, b) => a.index - b.index);
  const result = ordered.map((row, index) => {
    if (row.index !== index || !Array.isArray(row.embedding)) throw new Error('向量服务返回顺序异常');
    vectorLiteral(row.embedding, dimensions);
    return Array.from(Float32Array.from(row.embedding as number[]));
  });
  if (++successes >= 10 && queue.concurrency < ragConfig.embeddingConcurrency) { queue.concurrency++; successes = 0; }
  return result;
}

// Shared, bounded provider queue across all jobs in this process; caller order is preserved.
export async function embedTexts(texts: string[], signal?: AbortSignal, stats?: EmbeddingStats): Promise<number[][]> {
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += ragConfig.embeddingBatchSize) chunks.push(texts.slice(i, i + ragConfig.embeddingBatchSize));
  const controller = new AbortController();
  const combined = AbortSignal.any([...(signal ? [signal] : []), controller.signal]);
  try { return (await Promise.all(chunks.map((items) => requestEmbeddingBatch(items, combined, stats)))).flat(); }
  catch (error) { controller.abort(); throw error; }
}

// User-scoped content-addressed cache: a private document never shares its vectors across owners.
export async function embedCachedTexts(userId: string, texts: string[], signal?: AbortSignal, stats = newEmbeddingStats()): Promise<number[][]> {
  const start = Date.now(); stats.texts += texts.length;
  if (!texts.length) return [];
  const unique = new Map(texts.map((text) => [textHash(text), text.normalize('NFC').trim()])); stats.unique += unique.size;
  const vectors = new Map<string, number[]>();
  for (const hash of unique.keys()) {
    const key = memoryKey(userId, hash); const cached = memory.get(key);
    if (cached && cached.expires > Date.now()) { const copy = Array.from(cached.vector); vectors.set(hash, copy); memory.delete(key); memory.set(key, cached); stats.memoryHits++; }
    else if (cached) memory.delete(key);
  }
  const absent = [...unique.keys()].filter((hash) => !vectors.has(hash));
  const rows = absent.length ? await prisma.$queryRaw<Array<{ hash: string; vector: string }>>(Prisma.sql`SELECT hash, encode(vector_send(embedding), 'base64') AS vector FROM "EmbeddingCache" WHERE "userId" = ${userId} AND profile = ${embeddingProfile} AND "expiresAt" > NOW() AND hash IN (${Prisma.join(absent)})`) : [];
  for (const row of rows) { const vector = decodeVectorBinary(row.vector); vectors.set(row.hash, vector); remember(memoryKey(userId, row.hash), vector); }
  stats.databaseHits += rows.length; stats.cacheHits += vectors.size;
  const missing = [...unique.entries()].filter(([hash]) => !vectors.has(hash));
  // Commit each successful batch so a failed later request can resume without re-embedding it.
  await Promise.all(Array.from({ length: Math.ceil(missing.length / ragConfig.embeddingBatchSize) }, async (_, index) => {
    const items = missing.slice(index * ragConfig.embeddingBatchSize, (index + 1) * ragConfig.embeddingBatchSize);
    const embedded = await requestEmbeddingBatch(items.map(([, text]) => text), signal, stats);
    signal?.throwIfAborted();
    const values = items.map(([hash], i) => { vectors.set(hash, embedded[i]); return Prisma.sql`(${userId}, ${embeddingProfile}, ${hash}, ${vectorLiteral(embedded[i])}::vector, NOW() + INTERVAL '30 days')`; });
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "EmbeddingCache" ("userId", profile, hash, embedding, "expiresAt") VALUES ${Prisma.join(values)} ON CONFLICT ("userId", profile, hash) DO UPDATE SET embedding = EXCLUDED.embedding, "expiresAt" = EXCLUDED."expiresAt"`);
    for (const [hash] of items) remember(memoryKey(userId, hash), vectors.get(hash)!);
  }));
  stats.durationMs += Date.now() - start;
  return texts.map((text) => vectors.get(textHash(text))!);
}
