import type { estypes } from '@elastic/elasticsearch';
import { prisma } from '../../prisma';
import { RagError, readableDocuments } from '../access';
import { elastic } from './client';
import { esConfig, generationProfile } from './config';
import { embedSearchTexts } from './embedding';
import { newEmbeddingStats } from '../embedding';
import { reciprocalRankFusion, diversify } from '../ranking';
import { rerank } from '../reranking';
import { ragConfig } from '../config';
import type { RetrievalDiagnostics } from '../types';
import type { RetrievalOptions, RetrievedChunk } from '../retrieval';

export type SearchMode = 'keyword' | 'vector' | 'hybrid' | 'hybrid_rescore' | 'rerank';
export function buildSearchRequests(query: string, generations: string[], vector?: number[], rescore = true) {
  const filter: estypes.QueryDslQueryContainer[] = [{ terms: { generationId: generations } }];
  const identifiers = [...new Set((query.match(/[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+/gi)||[]).map((s)=>s.toLowerCase()))];
  const keyword: estypes.SearchRequest = { index: esConfig.index, size: esConfig.candidates, _source: false, track_total_hits: false,
    query: { bool: { filter, must: [{ bool: { should: [{ multi_match: { query, fields: ['name^3','heading^2','text'], type: 'best_fields' } },...identifiers.map((id)=>({term:{identifiers:{value:id,boost:8}}}))], minimum_should_match:1 } }] } },
    ...(rescore ? { rescore: { window_size: Math.max(esConfig.candidates,esConfig.rescoreWindow), query: { query_weight: 1, rescore_query_weight: 2, rescore_query: { bool: { should: [{ match_phrase: { text: { query, slop: 1, boost: 2 } } },{ match_phrase: { heading: { query, slop: 0, boost: 3 } } }] } } } } } : {}) };
  const knn: estypes.SearchRequest = { index: esConfig.index, size: esConfig.candidates, _source: false, track_total_hits: false,
    knn: { field: 'embedding', query_vector: vector, k: esConfig.candidates, num_candidates: Math.max(esConfig.candidates,esConfig.numCandidates), filter, similarity:0.25 } };
  return { keyword, knn };
}
export async function esAuthorizedDocuments(userId: string, ids: string[]) {
  const docs = await prisma.document.findMany({ where: { ...readableDocuments(userId), id: { in: ids }, isCurrent: true, status:'ready' }, include: { knowledgeBase: true } });
  if (docs.length!==ids.length) throw new RagError('部分资料不存在或尚未就绪，请重新选择',404);
  const generations = await prisma.ragGeneration.findMany({where:{ id:{in:docs.flatMap((d)=>d.activeGenerationId?[d.activeGenerationId]:[])},status:'ready'}});
  if (docs.some((d)=>!generations.some((g)=>g.id===d.activeGenerationId&&g.documentId===d.id&&g.profile===generationProfile(d.knowledgeBase?.chunkingStrategy)))) throw new RagError('部分资料需要建立新的 Elasticsearch 索引，请在管理平台重新索引',409);
  return docs;
}
export async function searchElasticsearch(userId: string, documentIds: string[], query: string, signal: AbortSignal, options: RetrievalOptions = {}) {
  // Neural reranking remains explicit: the fixed local evaluation did not
  // improve ranking enough to justify an extra model call on every chat turn.
  const started=Date.now();const mode = options.mode || 'hybrid_rescore';
  const diagnostics: RetrievalDiagnostics={mode,backend:'elasticsearch',vectorCandidates:0,keywordCandidates:0,fusedCandidates:0,rerank:{status:'disabled'},timings:{},embeddingCacheHits:0,filters:{documentCount:documentIds.length,tags:options.tags||[]},expandedParents:0,rescoreApplied:mode==='rerank'||mode==='hybrid_rescore'};
  if (!documentIds.length) return {chunks:[] as RetrievedChunk[],diagnostics};
  const documents=await esAuthorizedDocuments(userId,documentIds);
  const allowed=documents.filter((d)=>(options.tags||[]).every((tag)=>d.tags.includes(tag)));const generationIds=allowed.map((d)=>d.activeGenerationId!);
  if (!generationIds.length) return {chunks:[] as RetrievedChunk[],diagnostics};
  type Hit={id:string;score:number}; const stats=newEmbeddingStats(); const warnings:string[]=[];
  const keywordTask=(async():Promise<Hit[]>=>{if(mode==='vector')return[];const t=Date.now();const request=buildSearchRequests(query,generationIds,undefined,diagnostics.rescoreApplied);const result=await elastic().search(request.keyword,{signal});diagnostics.timings.keywordMs=Date.now()-t;return result.hits.hits.flatMap((h)=>h._id?[{id:h._id,score:h._score||0}]:[]);})();
  const vectorTask=(async():Promise<Hit[]>=>{if(mode==='keyword')return[];const t=Date.now();const [vector]=await embedSearchTexts(userId,[query],AbortSignal.any([signal,AbortSignal.timeout(15000)]),stats);diagnostics.timings.embeddingMs=Date.now()-t;diagnostics.embeddingCacheHits=stats.cacheHits;const s=Date.now();const result=await elastic().search(buildSearchRequests(query,generationIds,vector).knn,{signal});diagnostics.timings.vectorMs=Date.now()-s;return result.hits.hits.flatMap((h)=>h._id?[{id:h._id,score:h._score||0}]:[]);})().catch((error)=>{signal.throwIfAborted();if(mode==='vector')throw error;warnings.push('向量召回不可用，本次保留 BM25 候选');return[] as Hit[];});
  const [keywordHits,vectorHits]=await Promise.all([keywordTask,vectorTask]);signal.throwIfAborted();
  const ids=[...new Set([...keywordHits,...vectorHits].map((h)=>h.id))];
  // Materialize only DB-authorized chunks BEFORE sending candidate text to an external reranker.
  const records=ids.length?await prisma.chunk.findMany({where:{id:{in:ids},generationId:{in:generationIds},kind:'leaf',document:{...readableDocuments(userId),isCurrent:true,status:'ready',id:{in:allowed.map((d)=>d.id)}}},include:{document:{select:{id:true,name:true,activeGenerationId:true}}}}):[];
  const map=new Map(records.filter((r)=>r.generationId===r.document.activeGenerationId).map((r)=>[r.id,r]));
  const rows=(hits:Hit[],kind:'keyword'|'vector'):RetrievedChunk[]=>hits.flatMap((hit)=>{const r=map.get(hit.id);return r?[{id:r.id,documentId:r.documentId,name:r.document.name,text:r.text,page:r.page,heading:r.heading,parentId:r.parentId||undefined,score:hit.score,...(kind==='vector'?{vectorScore:hit.score}:{})}]:[];});
  const keyword=rows(keywordHits,'keyword'),vector=rows(vectorHits,'vector');diagnostics.keywordCandidates=keyword.length;diagnostics.vectorCandidates=vector.length;
  const f=Date.now();let candidates=mode==='keyword'?keyword:mode==='vector'?vector:reciprocalRankFusion([{items:keyword},{items:vector}]).slice(0,esConfig.candidates);diagnostics.fusedCandidates=candidates.length;diagnostics.timings.fusionMs=Date.now()-f;
  if(mode==='rerank'&&candidates.length){const t=Date.now();const ranked=await rerank(query,candidates,signal);candidates=ranked.items;diagnostics.rerank=ranked.info;diagnostics.timings.rerankMs=Date.now()-t;}
  const topK=Math.min(12,Math.max(1,options.topK||ragConfig.retrievalTopK));let chunks=diversify(candidates,topK);
  if(options.expandParents!==false){const parentIds=[...new Set(chunks.flatMap((c)=>c.parentId?[c.parentId]:[]))];const parents=parentIds.length?await prisma.chunk.findMany({where:{id:{in:parentIds},generationId:{in:generationIds},kind:'parent',document:{...readableDocuments(userId),isCurrent:true,status:'ready'}},include:{document:{select:{activeGenerationId:true}}}}):[];
    const byId=new Map(parents.filter((p)=>p.generationId===p.document.activeGenerationId).map((p)=>[p.id,p]));const seen=new Set<string>();chunks=chunks.flatMap((c)=>{const p=c.parentId?byId.get(c.parentId):undefined;const row=p?{...c,id:p.id,text:p.text,page:p.page,heading:p.heading,matchedChunkIds:[c.id]}:c;if(seen.has(row.id))return[];seen.add(row.id);return[row];});diagnostics.expandedParents=byId.size;
  }
  // Recheck after model latency as membership, publication or version can change during the request.
  const fresh=await prisma.document.findMany({where:{...readableDocuments(userId),id:{in:chunks.map((c)=>c.documentId)},isCurrent:true,status:'ready'},select:{id:true,activeGenerationId:true}});
  chunks=chunks.filter((c)=>fresh.some((d)=>d.id===c.documentId&&generationIds.includes(d.activeGenerationId||'')));
  diagnostics.timings.totalMs=Date.now()-started;if(warnings.length)diagnostics.warnings=warnings;
  return{chunks,diagnostics};
}
