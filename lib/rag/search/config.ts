import { envInt } from '../config';
import { embeddingProfile } from '../embedding';
import { pipelineProfile } from '../splitting';

export const esEnabled = () => process.env.RAG_SEARCH_BACKEND === 'elasticsearch';
export const kafkaEnabled = () => process.env.RAG_INGESTION_BACKEND === 'kafka';
export const SEARCH_DIMENSIONS = 2048;
export const searchEmbeddingProfile = embeddingProfile.replace(':1024:v1', ':2048:v1');
export const generationProfile = (strategy = 'recursive') => `es-hnsw-ik:v1:${pipelineProfile(strategy).replace(embeddingProfile, searchEmbeddingProfile)}`;
export const esConfig = {
  index: process.env.ELASTICSEARCH_INDEX || 'sky-chat-chunks-v1',
  candidates: envInt('ES_CANDIDATES', 50, 6, 200),
  numCandidates: envInt('ES_NUM_CANDIDATES', 200, 200, 10000),
  rescoreWindow: envInt('ES_RESCORE_WINDOW', 100, 50, 1000),
};
