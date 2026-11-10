import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { embedCachedTexts, embeddingProfile, newEmbeddingStats, vectorLiteral } from './embedding';
import { authorizedDocuments, documentPermissionSql, readableDocuments } from './access';
import { reciprocalRankFusion, diversify } from './ranking';
import { rerank } from './reranking';
import { ragConfig } from './config';
import { searchTerms } from './tokenization';
import type { RetrievalDiagnostics } from './types';
import { esEnabled } from './search/config';

export interface RetrievedChunk {
  id: string; documentId: string; name: string; text: string;
  page: number | null; heading: string | null; score: number;
  parentId?: string | null; matchedChunkIds?: string[]; fusionScore?: number; rerankScore?: number; vectorScore?: number;
}
export interface RetrievalOptions { mode?: 'keyword' | 'vector' | 'hybrid' | 'hybrid_rescore' | 'rerank'; topK?: number; tags?: string[]; expandParents?: boolean }
export async function searchKnowledgeDetailed(userId: string, documentIds: string[], query: string, signal: AbortSignal, options: RetrievalOptions = {}) {
  if (esEnabled()) return (await import('./search/retrieval')).searchElasticsearch(userId,documentIds,query,signal,options);
  const start = Date.now(); const mode = options.mode || (ragConfig.rerankEnabled ? 'rerank' : 'hybrid');
  const topK = Math.min(12, Math.max(1, options.topK || ragConfig.retrievalTopK));
  const diagnostics: RetrievalDiagnostics = { mode, vectorCandidates: 0, keywordCandidates: 0, fusedCandidates: 0, rerank: { status: 'disabled' }, timings: {}, embeddingCacheHits: 0, filters: { documentCount: documentIds.length, tags: options.tags || [] }, expandedParents: 0 };
  if (!documentIds.length) return { chunks: [] as RetrievedChunk[], diagnostics };
  await authorizedDocuments(userId, documentIds);
  const scope = Prisma.sql`${documentPermissionSql(userId)} AND d.id IN (${Prisma.join(documentIds)}) AND d.status = 'ready' AND d."isCurrent" = true AND d."embeddingModel" = ${embeddingProfile} AND c.kind = 'leaf'`;
  const tags = options.tags?.length ? Prisma.sql`AND d.tags @> ARRAY[${Prisma.join(options.tags)}]::text[]` : Prisma.empty;
  const columns = Prisma.sql`c.id, c."documentId", c.text, c.page, c.heading, c."parentId", d.name`;
  const stats = newEmbeddingStats(); const embeddingStart = Date.now();
  const vectorTask = (async () => {
    if (mode === 'keyword') return [] as RetrievedChunk[];
    const [embedding] = await embedCachedTexts(userId, [query], AbortSignal.any([signal, AbortSignal.timeout(15000)]), stats);
    diagnostics.timings.embeddingMs = Date.now() - embeddingStart; diagnostics.embeddingCacheHits = stats.cacheHits;
    signal.throwIfAborted(); const sqlStart = Date.now(); const vector = vectorLiteral(embedding);
    const rows = await prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`SELECT ${columns}, (1 - (c.embedding <=> ${vector}::vector))::float8 AS score FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId" WHERE ${scope} ${tags} AND c.embedding IS NOT NULL AND (1 - (c.embedding <=> ${vector}::vector)) >= 0.25 ORDER BY c.embedding <=> ${vector}::vector, c.id LIMIT ${ragConfig.retrievalCandidates}`);
    diagnostics.timings.vectorMs = Date.now() - sqlStart;
    return rows.map((row) => ({ ...row, vectorScore: row.score }));
  })().catch((error) => { signal.throwIfAborted(); if (mode === 'vector') throw error; diagnostics.warnings = ['向量召回不可用，本次仅使用全文候选']; return [] as RetrievedChunk[]; });
  const keywordTask = (async () => {
    const terms = searchTerms(query); if (mode === 'vector' || !terms.length) return [] as RetrievedChunk[];
    const sqlStart = Date.now();
    const rows = await prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`SELECT ${columns}, ts_rank_cd(c."searchVector", websearch_to_tsquery('simple', ${terms.join(' OR ')}))::float8 AS score FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId" WHERE ${scope} ${tags} AND c."searchVector" @@ websearch_to_tsquery('simple', ${terms.join(' OR ')}) ORDER BY score DESC, c.id LIMIT ${ragConfig.retrievalCandidates}`);
    diagnostics.timings.keywordMs = Date.now() - sqlStart; return rows;
  })();
  const [vector, keyword] = await Promise.all([vectorTask, keywordTask]); signal.throwIfAborted();
  diagnostics.vectorCandidates = vector.length; diagnostics.keywordCandidates = keyword.length;
  const fusionStart = Date.now();
  let candidates: RetrievedChunk[] = mode === 'vector' ? vector : mode === 'keyword' ? keyword : reciprocalRankFusion([{ items: vector }, { items: keyword }]).slice(0, ragConfig.retrievalCandidates);
  diagnostics.fusedCandidates = candidates.length; diagnostics.timings.fusionMs = Date.now() - fusionStart;
  if (mode === 'rerank' && candidates.length) { const rerankStart = Date.now(); const ranked = await rerank(query, candidates, signal); candidates = ranked.items; diagnostics.rerank = ranked.info; diagnostics.timings.rerankMs = Date.now() - rerankStart; }
  let chunks = mode === 'vector' ? candidates.slice(0, topK) : diversify(candidates, topK);
  if (options.expandParents !== false && mode !== 'vector') {
    const ids = [...new Set(chunks.map((c) => c.parentId).filter((id): id is string => !!id))];
    const parents = ids.length ? await prisma.chunk.findMany({ where: { id: { in: ids }, kind: 'parent', document: { ...readableDocuments(userId), id: { in: documentIds }, isCurrent: true } } }) : [];
    const byId = new Map(parents.map((p) => [p.id, p])); const seen = new Set<string>();
    chunks = chunks.map((chunk) => {
      const parent = chunk.parentId ? byId.get(chunk.parentId) : undefined;
      return parent ? { ...chunk, id: parent.id, text: parent.text, page: parent.page, heading: parent.heading, matchedChunkIds: [chunk.id] } : chunk;
    }).filter((chunk) => { if (seen.has(chunk.id)) return false; seen.add(chunk.id); return true; });
    diagnostics.expandedParents = parents.length;
  }
  diagnostics.timings.totalMs = Date.now() - start;
  return { chunks, diagnostics };
}
export async function searchKnowledge(userId: string, documentIds: string[], query: string, signal: AbortSignal) { return (await searchKnowledgeDetailed(userId, documentIds, query, signal)).chunks; }

export async function readContext(userId: string, documentIds: string[], chunkId: string): Promise<RetrievedChunk[]> {
  if (esEnabled()) await authorizedDocuments(userId,documentIds);
  const scope = { ...readableDocuments(userId), id: { in: documentIds }, status: 'ready', isCurrent: true, ...(esEnabled()?{}:{embeddingModel:embeddingProfile}) };
  const chunk = await prisma.chunk.findFirst({ where: { id: chunkId, document: scope }, include: { document: { select: { activeGenerationId: true } } } });
  if (!chunk) throw new Error('来源片段不在当前授权资料范围内');
  if (esEnabled() && chunk.generationId !== chunk.document.activeGenerationId) throw new Error('来源片段不属于当前索引');
  if (chunk.parentId) {
    const parent = await prisma.chunk.findFirst({ where: { id: chunk.parentId, documentId: chunk.documentId, document: scope }, include: { document: { select: { name: true } } } });
    if (parent) return [{ ...parent, name: parent.document.name, score: 0 }];
  }
  const rows = await prisma.chunk.findMany({ where: { documentId: chunk.documentId, generationId: chunk.generationId, kind: chunk.kind, ordinal: { gte: Math.max(0, chunk.ordinal - 1), lte: chunk.ordinal + 1 }, document: scope }, orderBy: { ordinal: 'asc' }, select: { id: true, documentId: true, text: true, page: true, heading: true, document: { select: { name: true } } } });
  return rows.map(({ document, ...row }) => ({ ...row, name: document.name, score: 0 }));
}
