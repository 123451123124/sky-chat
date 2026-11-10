import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { chromium } from '@playwright/test';
import { SSEParser } from '../lib/sse-parser';
import { removeFile } from '../lib/rag/storage';
import type { RagTrace } from '../lib/rag/types';
import { esEnabled, esConfig } from '../lib/rag/search/config';
import { elastic } from '../lib/rag/search/client';
import { removeArtifacts } from '../lib/rag/pipeline/artifacts';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100';
const db = new PrismaClient();
const users: string[] = [];
const documents: string[] = [];
const checks: string[] = [];
const report: Record<string, unknown> = { date: new Date().toISOString(), checks };
const namespace = randomUUID();
async function api(cookie: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, { ...init, headers: { ...init.headers, Cookie: cookie }, signal: AbortSignal.timeout(170000) });
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function identity(label: string, role = 'user') {
  const user = await db.user.create({ data: { email: `rag-test-${label}-${namespace}@example.test`, name: `RAG 验证 ${label}`, role, password: `disabled-login-${randomUUID()}` } });
  users.push(user.id); assert.ok(process.env.JWT_SECRET);
  const token = await new SignJWT({ userId: user.id, email: user.email, role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('20m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return { id: user.id, cookie: `sky-chat-token=${token}`, token };
}
function samplePdf() {
  const content = 'BT /F1 16 Tf 40 760 Td (RAG demo: archive retention is 23 days.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let file = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(file)); file += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(file);
  file += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file);
}
async function upload(cookie: string, name: string, content: string | Buffer, kb?: string) {
  const form = new FormData(); form.append('file', new Blob([new Uint8Array(Buffer.from(content))]), name); if (kb) form.append('knowledgeBaseId', kb);
  const response = await api(cookie, '/api/documents', { method: 'POST', body: form });
  assert.equal(response.status, 202, 'upload should enqueue a document');
  const data = await response.json(); documents.push(data.documentId); return data.documentId as string;
}
async function waitReady(cookie: string, id: string) {
  for (let i = 0; i < 90; i++) {
    const response = await api(cookie, `/api/documents/${id}`); assert.equal(response.status, 200);
    const { document } = await response.json();
    if (document.status === 'ready' && !(esEnabled()&&document.pendingGenerationId)) return document;
    assert.notEqual(document.status, 'failed', `document ingestion failed: ${document.error}`);
    await delay(1500);
  }
  throw new Error('Document processing timeout: confirm rag:worker is running');
}
async function waitFailed(cookie: string, id: string) {
  for (let i = 0; i < 40; i++) {
    const { document } = await (await api(cookie, `/api/documents/${id}`)).json();
    if (document.status === 'failed') return;
    await delay(1000);
  }
  throw new Error('Invalid document did not reach a recoverable failure state');
}
async function chat(cookie: string, sessionId: string, messages: Array<{ role: string; content: string }>) {
  const start = Date.now();
  const response = await api(cookie, '/api/chat', json({ sessionId, model: 'qwen3.7-plus', searchEnabled: false, messages }));
  assert.equal(response.status, 200, 'chat should start');
  const parser = new SSEParser(); const events = parser.parse(await response.text()).map((e) => JSON.parse(e.data));
  const error = events.find((e) => e.type === 'error'); assert.ok(!error, error?.errorText);
  assert.ok(events.some((e) => e.type === 'finish'), 'stream must finish');
  const trace = events.filter((e) => e.type === 'rag-trace').at(-1)?.trace as RagTrace;
  assert.ok(trace && trace.status !== 'failed', 'canonical RAG trace must be present');
  const answer = events.findLast((e) => e.type === 'text-replace')?.text || events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('');
  return { trace, answer: answer as string, durationMs: Date.now() - start };
}

async function main() {
  const a = await identity('A', 'admin'); const b = await identity('B');
  assert.equal((await fetch(`${base}/api/knowledge`)).status, 401); checks.push('unauthenticated requests rejected');
  const kbResponse = await api(a.cookie, '/api/knowledge', json({ name: '公开示例知识库' })); assert.equal(kbResponse.status, 201); const kb = await kbResponse.json();
  const draftBase = await (await api(a.cookie, '/api/knowledge', json({ name: '失败任务验证草稿' }))).json();
  assert.equal((await api(b.cookie, '/api/knowledge', json({ name: 'forbidden' }))).status, 403);
  assert.equal((await api(b.cookie, '/api/knowledge?manage=1')).status, 403);
  const forbiddenForm = new FormData(); forbiddenForm.append('file', new Blob(['test']), 'test.txt');
  assert.equal((await api(b.cookie, '/api/documents', { method: 'POST', body: forbiddenForm })).status, 403);
  const one = await upload(a.cookie, '白鹭项目.md', '# 白鹭项目（虚构测试资料）\n## 限制\n白鹭项目的日志保留期是 17 天。允许上传的附件上限是 8 MB。\n本文件仅用于功能验证，不是实际产品政策。', kb.id);
  const two = await upload(a.cookie, '青禾项目.txt', '青禾项目（虚构测试资料）：日志保留期是 29 天。允许上传的附件上限是 16 MB。本文件仅用于功能验证，不是实际产品政策。', kb.id);
  const pdf = await upload(a.cookie, '公开PDF示例.pdf', samplePdf(), kb.id);
  await Promise.all([one, two, pdf].map((id) => waitReady(a.cookie, id)));
  const pdfChunk = await db.chunk.findFirst({ where: { documentId: pdf }, select: { page: true, text: true } });
  assert.equal(pdfChunk?.page, 1); assert.match(pdfChunk.text, /23 days/); checks.push('Markdown, text and PDF ingested using real embeddings; PDF page retained');
  assert.equal((await api(a.cookie, `/api/documents/${pdf}`, json({ action: 'reindex' }, 'PATCH'))).status, 200);
  await waitReady(a.cookie, pdf);
  const currentPdf=await db.document.findUniqueOrThrow({where:{id:pdf}});
  assert.equal(await db.chunk.count({ where: { documentId: pdf, kind: 'leaf', ...(esEnabled()?{generationId:currentPdf.activeGenerationId}:{}) } }), 1);
  const invalid = await upload(a.cookie, '无效PDF测试.pdf', 'This is deliberately not a PDF; synthetic failure test.', draftBase.id);
  await waitFailed(a.cookie, invalid);
  assert.equal((await api(a.cookie, `/api/documents/${invalid}`, json({ action: 'retry' }, 'PATCH'))).status, 200);
  await waitFailed(a.cookie, invalid); checks.push('re-index activates a complete generation; invalid file can fail and retry');
  if(esEnabled()) {
    assert.equal((await api(b.cookie,'/api/admin/pipeline')).status,403);
    const health=await api(a.cookie,'/api/admin/pipeline?health=1');assert.equal(health.status,200);
    const payload=await health.json();assert.ok(payload.generations.length>=3);
    checks.push('production pipeline API exposes owner tasks and rejects non-admin access');
  }
  const sessionResponse = await api(a.cookie, '/api/session', json({ title: 'RAG 真实链路验证', documentIds: [one, two] })); assert.equal(sessionResponse.status, 200); const session = await sessionResponse.json();
  assert.equal((await api(b.cookie, `/api/documents/${one}`)).status, 404);
  assert.equal((await api(b.cookie, `/api/documents/${one}?download=1`)).status, 404);
  assert.equal((await api(b.cookie, `/api/knowledge?sessionId=${session.id}`)).status, 404);
  const bSession = await (await api(b.cookie, '/api/session', json({ title: '隔离验证' }))).json();
  assert.equal((await api(b.cookie, `/api/session/${bSession.id}/documents`, json({ documentIds: [one] }, 'PUT'))).status, 404); checks.push('cross-user document access, download, selection and session scope rejected');
  assert.equal((await api(a.cookie, '/api/knowledge', json({ id: draftBase.id, published: true }, 'PATCH'))).status, 409);
  assert.equal((await api(a.cookie, '/api/knowledge', json({ id: kb.id, published: true }, 'PATCH'))).status, 200);
  assert.equal((await api(b.cookie, `/api/documents/${one}?download=1`)).status, 200);
  assert.equal((await api(b.cookie, `/api/session/${bSession.id}/documents`, json({ documentIds: [one, two] }, 'PUT'))).status, 200);
  assert.equal((await api(b.cookie, `/api/documents/${one}`, { method: 'DELETE' })).status, 403);
  assert.equal((await api(b.cookie, `/api/documents/${one}`, json({ action: 'reindex' }, 'PATCH'))).status, 403);
  assert.equal((await api(b.cookie, '/api/knowledge', json({ id: kb.id, published: false }, 'PATCH'))).status, 403);
  assert.equal((await api(a.cookie, `/api/documents/${one}`, json({ action: 'reindex' }, 'PATCH'))).status, 409);
  const listing = await (await api(b.cookie, '/api/knowledge')).json();
  assert.ok(listing.documents.some((d: {id:string}) => d.id === one));
  assert.ok(!listing.documents.some((d: {id:string}) => d.id === invalid));
  checks.push('admin-only writes, draft isolation, publication readiness and shared read access enforced');
  const question = '根据资料，白鹭项目和青禾项目各自的日志保留期是多少？相差多少天？';
  await api(a.cookie, '/api/message', json({ sessionId: session.id, role: 'user', content: question }));
  const first = await chat(a.cookie, session.id, [{ role: 'user', content: question }]);
  assert.match(first.answer, /17/); assert.match(first.answer, /29/); assert.match(first.answer, /12/);
  assert.ok(first.trace.sources.some((s) => s.documentId === one)); assert.ok(first.trace.sources.some((s) => s.documentId === two));
  assert.ok(first.trace.citedSourceIds.length >= 2); assert.equal(first.trace.invalidCitationCount, 0);
  await api(a.cookie, '/api/message', json({ sessionId: session.id, role: 'assistant', content: first.answer, parts: [{ type: 'text', text: first.answer, state: 'done' }, { type: 'rag', trace: first.trace }] })); checks.push('cross-document answer and verified citations using real chat model');
  assert.equal((await api(b.cookie, `/api/agent-runs/${first.trace.runId}`)).status, 404);
  assert.equal((await api(a.cookie, `/api/agent-runs/${first.trace.runId}`)).status, 200); checks.push('execution records persisted and isolated');
  const followQuestion = '它们允许上传的附件分别多大？';
  const follow = await chat(a.cookie, session.id, [{ role: 'user', content: question }, { role: 'assistant', content: first.answer }, { role: 'user', content: followQuestion }]);
  assert.match(follow.answer, /8/); assert.match(follow.answer, /16/);
  assert.ok(follow.trace.steps.some((s) => s.tool === 'searchKnowledge' && /白鹭|青禾/.test(s.query))); checks.push('follow-up pronouns rewritten into scoped queries');
  await api(a.cookie, '/api/message', json({ sessionId: session.id, role: 'user', content: followQuestion }));
  await api(a.cookie, '/api/message', json({ sessionId: session.id, role: 'assistant', content: follow.answer, parts: [{ type: 'text', text: follow.answer, state: 'done' }, { type: 'rag', trace: follow.trace }] }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'sky-chat-token', value: a.token, url: base }]);
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/chat`); await page.getByRole('button', { name: 'RAG 真实链路验证', exact: true }).click();
    await page.getByRole('button', { name: '查看检索路径与原文' }).last().click();
    const dialog = page.getByRole('dialog', { name: '检索路径与原文' });
    await dialog.getByRole('button', { name: '3D 关系', exact: true }).click(); await page.waitForSelector('canvas[data-source-graph-ready="true"]');
    await dialog.getByRole('button', { name: /S1 ·/ }).click(); await page.waitForSelector('.sky-original-snippet .sky-source-download');
    await page.screenshot({ path: 'reports/screenshots/rag-real-desktop.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: '关闭来源视图' }).click(); await page.getByRole('button', { name: '文件与知识库', exact: true }).click();
    await page.waitForSelector('.sky-document-row');
    await page.screenshot({ path: 'reports/screenshots/rag-real-library.png', animations: 'disabled' });
    await page.getByRole('button', { name: '完成选择' }).click();
    await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
    await page.getByRole('button', { name: '查看检索路径与原文' }).last().click();
    await page.waitForSelector('canvas[data-source-graph-ready="true"]');
    await page.screenshot({ path: 'reports/screenshots/rag-real-dark.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: '关闭来源视图' }).click();
    await page.getByRole('button', { name: '切换亮色模式', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '查看检索路径与原文' }).last().click();
    await page.waitForSelector('canvas[data-source-graph-ready="true"]');
    await page.screenshot({ path: 'reports/screenshots/rag-real-mobile.png', animations: 'disabled' });
    assert.deepEqual(errors, []); checks.push('production UI restores sources and renders real 3D evidence without page errors'); await context.close();
  } finally { await browser.close(); }
  const simple = await chat(b.cookie, bSession.id, [{ role: 'user', content: '白鹭项目的日志保留期是多少？' }]);
  assert.match(simple.answer, /17/);
  assert.ok(!simple.trace.steps.some((step) => step.tool === 'planQueries')); checks.push('simple file question skips the extra query-planning model call');
  const missing = await chat(a.cookie, session.id, [{ role: 'user', content: '资料里说这两个项目的飞行速度各是多少公里每小时？' }]);
  assert.match(missing.answer, /未|没有|无法|不足|不涉及/); assert.doesNotMatch(missing.answer, /\d+\s*(公里|千米)/); checks.push('unsupported question reports missing evidence');
  assert.equal((await api(a.cookie, '/api/knowledge', json({ id: kb.id, published: false }, 'PATCH'))).status, 200);
  assert.equal((await api(b.cookie, `/api/documents/${one}?download=1`)).status, 404);
  assert.equal((await api(b.cookie, `/api/session/${bSession.id}/documents`, json({ documentIds: [one] }, 'PUT'))).status, 404);
  checks.push('unpublication revokes new source reads and document selection');
  assert.equal((await api(a.cookie, `/api/documents/${one}`, { method: 'DELETE' })).status, 200);
  assert.equal(await db.chunk.count({ where: { documentId: one } }), 0);
  assert.equal((await api(a.cookie, `/api/documents/${one}?chunkId=${first.trace.sources.find((s) => s.documentId === one)!.chunkId}`)).status, 404);
  const selected = await (await api(a.cookie, `/api/knowledge?sessionId=${session.id}`)).json(); assert.ok(!selected.selectedIds.includes(one)); checks.push('deletion removes chunks and session associations; old source cannot be loaded');
  report.measurements = { firstAnswerMs: first.durationMs, followUpMs: follow.durationMs, simpleAnswerMs: simple.durationMs, firstSteps: first.trace.steps.map((s) => ({ tool: s.tool, durationMs: s.durationMs })), firstCitedSources: first.trace.citedSourceIds.length };
  report.status = 'passed';
}
void main().catch((error) => { report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Unknown error'; process.exitCode = 1; }).finally(async () => {
  try {
    const generations=esEnabled()?await db.ragGeneration.findMany({where:{documentId:{in:documents}},select:{id:true}}):[];
    if(generations.length)await db.ragIndexCleanup.createMany({data:generations.map(({id})=>({generationId:id,availableAt:new Date(Date.now()+300000)})),skipDuplicates:true});
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users }, email: { contains: namespace } } });
    for (const id of documents) await removeFile(id).catch(() => {});
    if(generations.length){await elastic().deleteByQuery({index:esConfig.index,query:{terms:{generationId:generations.map(({id})=>id)}},refresh:true,conflicts:'proceed'}).catch(()=>{});for(const {id} of generations)await removeArtifacts(id);}
    report.cleanup = 'completed';
  } catch { report.cleanup = 'failed'; process.exitCode = 1; }
  await mkdir('reports', { recursive: true }); await writeFile(esEnabled()?'reports/rag-es-web-smoke.json':'reports/rag-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await db.$disconnect();
});
