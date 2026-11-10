import { test } from 'node:test';
import assert from 'node:assert/strict';

// Network is stubbed in every test; exercise the configured-provider path too.
process.env.SEARCH_API_KEY = 'unit-test-placeholder-not-a-real-key';

function response(delta: object, finish: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
}
function toolCall(name: string, args: string, id = 'call') {
  return { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] };
}

test('unadvertised tools cannot execute even when a model repeatedly requests them', async () => {
  const { runAgent } = await import('../lib/agent/runtime');
  const original = globalThis.fetch;
  const requests: string[] = [];
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  try {
    globalThis.fetch = async (url) => { requests.push(String(url)); return response(toolCall('webSearch', '{"query":"private text"}'), 'tool_calls'); };
    await runAgent({ userId: 'test', documentIds: [], model: 'test', messages: [{ role: 'user', content: '你好' }], searchEnabled: false, signal: new AbortController().signal, emit: (type, data) => events.push({ type, ...data }) });
    assert.equal(requests.length, 5, 'model loop must stop at its upper bound');
    assert.ok(requests.every((url) => url.endsWith('/chat/completions')));
    assert.ok(events.some((event) => event.type === 'tool-output-error'));
    assert.equal(events.at(-1)?.finishReason, 'max-steps');
  } finally { globalThis.fetch = original; }
});

test('invalid tool JSON is returned as a recoverable tool error, not silently coerced', async () => {
  const { runAgent } = await import('../lib/agent/runtime');
  const original = globalThis.fetch;
  let calls = 0;
  const errors: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      if (calls === 1) return response(toolCall('webSearch', '{broken'), 'tool_calls');
      const body = JSON.parse(init!.body as string);
      assert.ok(body.messages.some((m: { role: string; content: string }) => m.role === 'tool' && m.content.includes('参数无效')));
      return response({ content: '工具没有成功，我会说明这一点。' }, 'stop');
    };
    await runAgent({ userId: 'test', documentIds: [], model: 'test', messages: [{ role: 'user', content: '搜索' }], searchEnabled: true, signal: new AbortController().signal, emit: (type, data) => { if (type === 'tool-output-error') errors.push(String(data?.errorText)); } });
    assert.equal(calls, 2); assert.equal(errors.length, 1);
  } finally { globalThis.fetch = original; }
});

test('repeated enabled calls reuse a result and the final round excludes tools', async () => {
  const { runAgent } = await import('../lib/agent/runtime');
  const original = globalThis.fetch;
  let modelCalls = 0;
  let nonModelCalls = 0;
  let finished = false;
  try {
    globalThis.fetch = async (url, init) => {
      if (!String(url).endsWith('/chat/completions')) { nonModelCalls++; return Response.json({ results: [{ title: '公开测试资料', url: 'https://example.test', content: '测试内容' }] }); }
      modelCalls++;
      const body = JSON.parse(init!.body as string);
      if (!body.tools?.length) return response({ content: '根据已有结果结束。' }, 'stop');
      return response(toolCall('webSearch', '{"query":"相同问题"}', `call-${modelCalls}`), 'tool_calls');
    };
    await runAgent({ userId: 'test', documentIds: [], model: 'test', messages: [{ role: 'user', content: '搜索' }], searchEnabled: true, signal: new AbortController().signal, emit: (type) => { if (type === 'finish') finished = true; } });
    assert.equal(modelCalls, 5);
    assert.equal(nonModelCalls, 1, 'repeated calls must not repeat external side effects');
    assert.ok(finished);
  } finally { globalThis.fetch = original; }
});

test('a cancelled request never starts another model call', async () => {
  const { runAgent } = await import('../lib/agent/runtime');
  const original = globalThis.fetch;
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return response({ content: 'late' }, 'stop'); };
    await runAgent({ userId: 'test', documentIds: [], model: 'test', messages: [{ role: 'user', content: '停止' }], searchEnabled: false, signal: controller.signal, emit: () => {} });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
