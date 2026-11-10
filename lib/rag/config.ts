export function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
export const ragConfig = {
  embeddingConcurrency: envInt('EMBEDDING_CONCURRENCY', 3, 1, 8),
  embeddingRpm: envInt('EMBEDDING_RPM', 120, 1, 2000),
  embeddingBatchSize: envInt('EMBEDDING_BATCH_SIZE', 10, 1, 10),
  workerConcurrency: envInt('RAG_WORKER_CONCURRENCY', 2, 1, 4),
  retrievalCandidates: envInt('RAG_CANDIDATES', 24, 6, 80),
  retrievalTopK: envInt('RAG_TOP_K', 6, 1, 12),
  rerankEnabled: process.env.RERANK_ENABLED !== 'false',
};
