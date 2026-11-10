import { DEFAULT_BASE_URL } from '../models';
import { SSEParser } from '../sse-parser';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
export interface ToolDefinition {
  type: 'function'; function: { name: string; description: string; parameters: object };
}
export interface ModelOptions { model: string; messages: ModelMessage[]; signal: AbortSignal; tools?: ToolDefinition[] }
export async function modelRequest(options: ModelOptions, stream: boolean) {
  const base = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: options.model, messages: options.messages, stream, ...(options.tools?.length ? { tools: options.tools } : {}), ...(stream ? {} : { max_tokens: 800, response_format: { type: 'json_object' } }) }),
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(60000)]),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`模型服务暂时不可用（${response.status}），请稍后重试`); }
  return response;
}

export async function streamModel(options: ModelOptions, onDelta: (kind: 'text' | 'reasoning', delta: string) => void) {
  const response = await modelRequest(options, true);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('没有收到模型回复');
  const parser = new SSEParser();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();
  let text = '';
  let finishReason = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      const events = parser.parse(done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true }));
      for (const event of events) {
        if (event.data === '[DONE]') continue;
        let data;
        try { data = JSON.parse(event.data); } catch { continue; }
        if (data.error) throw new Error('模型生成失败，请重试');
        const choice = data.choices?.[0];
        const delta = choice?.delta;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (!delta) continue;
        if (typeof delta.content === 'string') { text += delta.content; onDelta('text', delta.content); }
        if (typeof delta.reasoning_content === 'string') onDelta('reasoning', delta.reasoning_content);
        for (const item of delta.tool_calls || []) {
          const call = calls.get(item.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (item.id) call.id = item.id;
          if (item.function?.name) call.function.name += item.function.name;
          call.function.arguments += item.function?.arguments || '';
          if (call.function.arguments.length > 12000 || calls.size > 8) throw new Error('工具参数超出限制');
          calls.set(item.index, call);
        }
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!finishReason) throw new Error('模型连接中断，已保留收到的内容，请重试');
  return { text, calls: [...calls.values()], finishReason };
}
