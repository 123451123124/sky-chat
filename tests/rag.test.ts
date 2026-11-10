import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkSections, textSections } from '../lib/rag/chunking';
import { vectorLiteral } from '../lib/rag/embedding';
import { verifyCitations } from '../lib/agent/citations';
import { buildSourceGraph } from '../lib/rag/graph';
import { streamModel } from '../lib/agent/model';
import type { RagTrace } from '../lib/rag/types';
import { needsQueryPlanning } from '../lib/agent/planning';
import { boundedFormData } from '../lib/rag/upload';

const source = { id: 'S1', documentId: 'doc', chunkId: 'chunk', name: '资料.md', page: 2, heading: null, excerpt: '可核查的片段', score: .8, stepIds: ['step'] };
const trace: RagTrace = { runId: 'run', question: '问题', status: 'completed', steps: [{ id: 'step', tool: 'searchKnowledge', query: '问题', status: 'completed', durationMs: 12, sourceIds: ['S1'] }], sources: [source], citedSourceIds: ['S1'], invalidCitationCount: 0 };

test('chunking preserves CJK text, page provenance and overlap without dropping tails', () => {
  const text = '中文知识片段。'.repeat(300) + '最后的独有内容';
  const chunks = chunkSections([{ text, page: 7, heading: '限制' }], 200, 30);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.text.length <= 200 && c.page === 7 && c.heading === '限制'));
  assert.ok(chunks.at(-1)!.text.endsWith('最后的独有内容'));
  for (let i = 0; i < text.length; i += 10) assert.ok(chunks.some((c) => c.text.includes(text.slice(i, i + 10))));
  assert.throws(() => chunkSections([], 100, 100));
});

test('Markdown headings inside fenced code do not split document sections', () => {
  const sections = textSections('# 概述\n正文\n```python\n# code comment\n```\n## 限制\n结尾', true);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, '概述');
  assert.ok(sections[0].text.includes('# code comment'));
  assert.equal(sections[1].heading, '概述 › 限制');
});

test('title-only Markdown headings remain attached to the following body', () => {
  const sections = textSections('# 产品\n## 配置\n实际说明。', true);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, '产品 › 配置');
  assert.ok(sections[0].text.includes('实际说明。'));
});

test('simple questions avoid extra planning while comparisons and contextual follow-ups use it', () => {
  assert.equal(needsQueryPlanning([{ role: 'user', content: '日志保留期是多少？' }]), false);
  assert.equal(needsQueryPlanning([{ role: 'user', content: '分别比较两个项目的限制' }]), true);
  assert.equal(needsQueryPlanning([{ role: 'user', content: '白鹭项目有哪些限制？' }, { role: 'assistant', content: '...' }, { role: 'user', content: '它的附件上限呢？' }]), true);
});

test('citations reject invented IDs and links from a different run', () => {
  const result = verifyCitations('[真实](#rag-run-S1) [伪造](#rag-other-S1) [S99] [S1]', 'run', [source]);
  assert.deepEqual(result.citedSourceIds, ['S1']);
  assert.equal(result.invalidCitationCount, 2);
  assert.ok(!result.content.includes('#rag-other'));
  assert.ok(!result.content.includes('[S99]'));
  assert.ok(result.content.includes('[S1](#rag-run-S1)'));
});

test('source layout is deterministic and only links actual retrieval provenance', () => {
  const graph = buildSourceGraph(trace);
  assert.deepEqual(graph, buildSourceGraph(structuredClone(trace)));
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(graph.links, [{ from: 'question', to: 'step:step' }, { from: 'step:step', to: 'source:S1' }, { from: 'source:S1', to: 'document:doc' }]);
  assert.equal(graph.nodes.find((n) => n.sourceId === 'S1')?.cited, true);
  assert.equal(buildSourceGraph({ ...trace, sources: [] }).nodes.length, 2);
});

test('embedding validation rejects NaN, wrong dimensions and zero vectors', () => {
  assert.throws(() => vectorLiteral([1, 2]));
  assert.throws(() => vectorLiteral(Array(1024).fill(NaN)));
  assert.throws(() => vectorLiteral(Array(1024).fill(0)));
  assert.ok(vectorLiteral(Array(1024).fill(.01)).startsWith('[0.01,'));
});

test('uploads without Content-Length are stopped before unbounded multipart buffering', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost/upload', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await assert.rejects(() => boundedFormData(request, 100), (e: unknown) => e instanceof Error && 'status' in e && e.status === 413);
  assert.ok(cancelled);
  const form = new FormData(); form.append('file', new Blob(['测试文本']), 'example.txt');
  const parsed = await boundedFormData(new Request('http://localhost/upload', { method: 'POST', body: form }));
  assert.equal(await (parsed.get('file') as File).text(), '测试文本');
});

test('upstream streaming survives byte boundaries and never accepts a truncated response as complete', async () => {
  const original = globalThis.fetch;
  const body = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好🌤️"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { for (const byte of body) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    const deltas: string[] = [];
    const result = await streamModel({ model: 'test', messages: [], signal: new AbortController().signal }, (kind, delta) => { if (kind === 'text') deltas.push(delta); });
    assert.equal(result.text, '你好🌤️'); assert.equal(deltas.join(''), result.text);
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    await assert.rejects(() => streamModel({ model: 'test', messages: [], signal: new AbortController().signal }, () => {}), /连接中断/);
  } finally { globalThis.fetch = original; }
});
