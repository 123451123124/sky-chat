import { Client } from '@elastic/elasticsearch';
import { esConfig, SEARCH_DIMENSIONS } from './config';

let singleton: Client | undefined;
export function elastic() {
  if (!singleton) {
    const apiKey = process.env.ELASTICSEARCH_API_KEY;
    singleton = new Client({ node: process.env.ELASTICSEARCH_URL || 'http://127.0.0.1:19200',
      ...(apiKey ? { auth: { apiKey } } : process.env.ELASTICSEARCH_USERNAME ? { auth: { username: process.env.ELASTICSEARCH_USERNAME, password: process.env.ELASTICSEARCH_PASSWORD || '' } } : {}),
      requestTimeout: 20000, maxRetries: 1 });
  }
  return singleton;
}
export async function ensureSearchIndex() {
  const client = elastic();
  if (await client.indices.exists({ index: esConfig.index })) {
    const mapping = await client.indices.getMapping({ index: esConfig.index });
    if (Object.values(mapping).some((m) => m.mappings.properties?.embedding?.type !== 'dense_vector' || (m.mappings.properties.embedding as { dims?: number }).dims !== SEARCH_DIMENSIONS)) throw new Error('Elasticsearch 索引维度不匹配，请创建独立索引');
    const health = await client.cluster.health({ index: esConfig.index, wait_for_status: 'yellow', timeout: '15s' });
    if (health.timed_out || health.status === 'red') throw new Error('Elasticsearch 主分片未就绪，请检查磁盘水位与分片分配');
    return;
  }
  const created = await client.indices.create({ index: esConfig.index, wait_for_active_shards: 1, timeout: '15s', settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '1s',
    analysis: { normalizer: { rag_identifier: { type: 'custom', filter: ['lowercase'] } }, analyzer: { rag_index: { type: 'custom', tokenizer: 'ik_max_word', filter: ['lowercase'] }, rag_query: { type: 'custom', tokenizer: 'ik_smart', filter: ['lowercase'] } } } },
    mappings: { dynamic: 'strict', properties: {
      documentId: { type: 'keyword' }, generationId: { type: 'keyword' }, profile: { type: 'keyword' }, ownerId: { type: 'keyword' }, knowledgeBaseId: { type: 'keyword' }, parentId: { type: 'keyword' }, tags: { type: 'keyword' },
      identifiers: { type: 'keyword', normalizer: 'rag_identifier' },
      text: { type: 'text', analyzer: 'rag_index', search_analyzer: 'rag_query', similarity: 'BM25' }, heading: { type: 'text', analyzer: 'rag_index', search_analyzer: 'rag_query' }, name: { type: 'text', analyzer: 'rag_index', search_analyzer: 'rag_query' },
      embedding: { type: 'dense_vector', dims: SEARCH_DIMENSIONS, index: true, similarity: 'cosine', index_options: { type: 'hnsw', m: 16, ef_construction: 100 } },
    } } });
  if (!created.shards_acknowledged) throw new Error('Elasticsearch 主分片未就绪，请检查磁盘水位与分片分配');
}
