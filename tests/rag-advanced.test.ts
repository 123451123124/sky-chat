import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitHierarchical, semanticGroups } from '../lib/rag/splitting';
import { reciprocalRankFusion, diversify } from '../lib/rag/ranking';
import { searchTerms, tokenize } from '../lib/rag/tokenization';
import { retryDelay, requestWithRetry } from '../lib/rag/provider';
import { embedTexts, newEmbeddingStats, decodeVectorBinary } from '../lib/rag/embedding';
import { rerank } from '../lib/rag/reranking';
import { retrievalMetrics } from '../lib/rag/evaluation';

test('LangChain parent/child chunks preserve provenance, bounds and the document tail', async () => {
  const text = '第一部分说明课程规则和退课条件。'.repeat(170) + '\n独有尾部标记END。';
  const chunks = await splitHierarchical([{text,page:3,heading:'课程规则'}], 'recursive', 'unused', AbortSignal.timeout(5000));
  const parents = chunks.filter((c) => c.kind === 'parent'); const leaves = chunks.filter((c) => c.kind === 'leaf');
  assert.ok(parents.length > 1 && leaves.length > parents.length);
  assert.ok(parents.every((p) => p.text.length <= 1800));
  assert.ok(leaves.every((c) => c.text.length <= 480 && c.page === 3 && c.heading === '课程规则' && parents[c.parentIndex!].text.includes(c.text)));
  assert.ok(leaves.some((c) => c.text.includes('独有尾部标记END')));
});
test('semantic boundaries respond to embedding changes and keep aligned content', () => {
  const parts = ['课程规则。'.repeat(80),'课程补充。'.repeat(80),'财务制度。'.repeat(80),'财务补充。'.repeat(80)];
  const groups = semanticGroups(parts, [[1,0],[1,0],[0,1],[0,1]]);
  assert.equal(groups.length, 2); assert.ok(groups[0].includes(parts[1])); assert.ok(groups[1].includes(parts[2]));
});
test('recursive fallback never separates UTF-16 surrogate pairs', async () => {
  const chunks = await splitHierarchical([{text:'A'+'😀𠀀'.repeat(1100),page:null,heading:null}], 'recursive', 'unused', AbortSignal.timeout(5000));
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((c) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(c.text)));
});
test('binary pgvector cache validates dimensions and float32 elements', () => {
  const bytes=Buffer.alloc(4100);bytes.writeUInt16BE(1024,0);for(let i=0;i<1024;i++)bytes.writeFloatBE(.25,4+i*4);
  assert.equal(decodeVectorBinary(bytes.toString('base64'))[50],.25);
  bytes.writeUInt16BE(512,0);assert.throws(()=>decodeVectorBinary(bytes.toString('base64')));
  assert.throws(()=>decodeVectorBinary('invalid'));
});
test('Chinese lexical tokens preserve identifiers and include unseen compound bigrams', () => {
  const tokens = tokenize('SEC-2026-07 的文件权限和课题组规定');
  assert.ok(tokens.includes('sec-2026-07')); assert.ok(tokens.includes('权限')); assert.ok(tokens.includes('课题'));
  const rare = tokenize('𠀀𠀁课程');
  assert.ok(rare.includes('𠀀𠀁')); assert.ok(rare.includes('𠀁课'));
  assert.ok(rare.every((word) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(word)));
  assert.ok(!searchTerms('的 是 the a').length); assert.ok(searchTerms('中文 '.repeat(100)).length <= 40);
});
test('RRF uses ranks instead of incomparable raw scores and ignores duplicate candidates', () => {
  const ranked = reciprocalRankFusion([{items:[{id:'a',score:999},{id:'b',score:1}]},{items:[{id:'b',score:.8},{id:'c',score:.7},{id:'c',score:.7}]}]);
  assert.equal(ranked[0].id,'b'); assert.equal(ranked.filter((r) => r.id === 'c').length,1);
});
test('diversification avoids duplicate parents and gives multiple files room', () => {
  const rows = [{id:'a1',documentId:'a',parentId:'p1'},{id:'a2',documentId:'a',parentId:'p1'},{id:'a3',documentId:'a',parentId:'p2'},{id:'a4',documentId:'a',parentId:'p3'},{id:'b1',documentId:'b',parentId:'p4'}];
  const result = diversify(rows,3); assert.equal(result.length,3); assert.ok(result.some((r) => r.documentId === 'b')); assert.equal(new Set(result.map((r) => r.parentId)).size,3);
});
test('batched embedding is bounded, restores provider response order and preserves caller order', async () => {
  const oldFetch=globalThis.fetch; const oldKey=process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY='test-only';
  let active=0; let max=0; let requests=0;
  try {
    globalThis.fetch=async (_url,init) => { const input=JSON.parse(String(init?.body)).input as string[]; requests++; active++; max=Math.max(max,active); await new Promise((r) => setTimeout(r,20)); active--; return Response.json({data:input.map((value,index) => ({index,embedding:Array(1024).fill(Number(value)+1)})).reverse()}); };
    const stats=newEmbeddingStats(); const vectors=await embedTexts(Array.from({length:35},(_,i) => String(i)),AbortSignal.timeout(5000),stats);
    assert.equal(requests,4); assert.ok(max > 1 && max <= 3); assert.deepEqual(vectors.map((v) => v[0]),Array.from({length:35},(_,i) => i+1));
  } finally { globalThis.fetch=oldFetch; if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey; }
});
test('provider retry respects retryable status and never retries invalid credentials', async () => {
  let attempts=0; let retries=0;
  const response=await requestWithRetry(async () => ++attempts === 1 ? new Response(null,{status:429,headers:{'Retry-After':'0'}}) : new Response('ok'),AbortSignal.timeout(3000),() => retries++);
  assert.equal(response.status,200); assert.equal(attempts,2); assert.equal(retries,1);
  attempts=0; await assert.rejects(() => requestWithRetry(async () => {attempts++;return new Response(null,{status:401});},AbortSignal.timeout(3000))); assert.equal(attempts,1);
  assert.equal(retryDelay(0,10000,0),10000); assert.equal(retryDelay(9,50000,0),15000);
});
test('cancelled embedding and retry operations never start an upstream request', async () => {
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(() => requestWithRetry(async () => {calls++;return new Response('ok');},controller.signal)); assert.equal(calls,0);
});
test('reranking validates provider indexes and exposes fallback rather than inventing scores', async () => {
  const original=globalThis.fetch;const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';
  const documents=[{id:'a',text:'日志 17 天'},{id:'b',text:'附件 8 MB'}];
  try {
    globalThis.fetch=async () => Response.json({output:{results:[{index:1,relevance_score:.9},{index:0,relevance_score:.2}]}});
    const sorted=await rerank('附件',documents,AbortSignal.timeout(5000));assert.equal(sorted.info.status,'applied');assert.deepEqual(sorted.items.map((d) => d.id),['b','a']);
    globalThis.fetch=async () => Response.json({output:{results:[{index:0,relevance_score:.9},{index:0,relevance_score:.2}]}});
    const fallback=await rerank('附件',documents,AbortSignal.timeout(5000));assert.equal(fallback.info.status,'fallback');assert.deepEqual(fallback.items,documents);
  } finally {globalThis.fetch=original;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
test('retrieval evaluation counts duplicate documents once and penalizes late relevant results', () => {
  const result=retrievalMetrics(['noise','a','a','b'],['a','b']); assert.equal(result.recallAt5,1); assert.equal(result.mrr,.5); assert.ok(result.ndcgAt5<1);
  assert.deepEqual(retrievalMetrics([],['a']),{recallAt5:0,mrr:0,ndcgAt5:0});
});
