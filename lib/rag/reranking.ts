import { requestWithRetry } from './provider';

export interface RerankStatus { status: 'applied' | 'disabled' | 'fallback'; model?: string; reason?: string }
export async function rerank<T extends { id: string; text: string }>(query: string, documents: T[], signal: AbortSignal): Promise<{ items: Array<T & { rerankScore?: number }>; info: RerankStatus }> {
  if (!documents.length) return { items: [], info: { status: 'disabled' } };
  const model = process.env.RERANK_MODEL || 'qwen3-rerank';
  const key = process.env.RERANK_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { items: documents, info: { status: 'fallback', model, reason: '重排服务未配置' } };
  const origin = new URL(process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').origin;
  const url = process.env.RERANK_URL || `${origin}/api/v1/services/rerank/text-rerank/text-rerank`;
  try {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
    const response = await requestWithRetry(() => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: { query: query.slice(0, 1200), documents: documents.map((d) => d.text.slice(0, 3000)) }, parameters: { top_n: documents.length, return_documents: false } }), signal: combined }), combined);
    const json = await response.json();
    const rows = json.output?.results;
    if (!Array.isArray(rows) || rows.length !== documents.length || new Set(rows.map((r) => r.index)).size !== documents.length || rows.some((r) => !Number.isInteger(r.index) || r.index < 0 || r.index >= documents.length || !Number.isFinite(r.relevance_score))) throw new Error('Invalid rerank response');
    return { items: rows.map((row) => ({ ...documents[row.index], rerankScore: row.relevance_score })), info: { status: 'applied', model } };
  } catch {
    signal.throwIfAborted();
    return { items: documents, info: { status: 'fallback', model, reason: '重排暂不可用，已保留混合召回排序' } };
  }
}
