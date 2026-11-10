import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { embeddingProfile } from '../lib/rag/embedding';

const db = new PrismaClient();
const namespace = randomUUID();
const ids: string[] = [];
const checks: string[] = [];
const report = { status: 'running', checks, cleanup: 'pending' };
async function identity(role: string) {
  const user = await db.user.create({ data: { email: `knowledge-${randomUUID()}-${namespace}@example.test`, password: `disabled-${randomUUID()}`, name: '知识库权限测试', role } }); ids.push(user.id);
  const token = await new SignJWT({ userId: user.id, email: user.email, role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return { id: user.id, cookie: `sky-chat-token=${token}` };
}
async function call(cookie: string, url: string, body?: object, method = 'POST') { return fetch(`http://127.0.0.1:3100${url}`, { method: body ? method : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); }
async function main() {
  const admin = await identity('admin'); const other = await identity('admin'); const user = await identity('user');
  const base = await (await call(admin.cookie, '/api/knowledge', { name: '移动目标测试' })).json();
  const foreignBase = await (await call(other.cookie, '/api/knowledge', { name: '其他管理员草稿' })).json();
  const original = await db.document.create({ data: { userId: admin.id, name: '虚构历史文件.md', mediaType: 'text/plain', size: 20, hash: namespace, status: 'queued', chunks: { create: { ordinal: 0, text: '仅用于移动与授权测试的虚构内容。' } } }, include: { chunks: true } });
  assert.equal((await call(user.cookie, `/api/documents/${original.id}`, { action: 'move', knowledgeBaseId: base.id }, 'PATCH')).status, 403);
  assert.equal((await call(other.cookie, `/api/documents/${original.id}`, { action: 'move', knowledgeBaseId: foreignBase.id }, 'PATCH')).status, 404);
  assert.equal((await call(admin.cookie, `/api/documents/${original.id}`, { action: 'move', knowledgeBaseId: foreignBase.id }, 'PATCH')).status, 409);
  assert.equal((await call(admin.cookie, `/api/documents/${original.id}`, { action: 'move', knowledgeBaseId: base.id }, 'PATCH')).status, 200);
  const moved = await db.document.findUniqueOrThrow({ where: { id: original.id }, include: { chunks: true } });
  assert.equal(moved.knowledgeBaseId, base.id); assert.deepEqual(moved.chunks.map((c) => c.id), original.chunks.map((c) => c.id));
  checks.push('moving preserves document and chunk IDs; role and ownership enforced on both groups');
  assert.equal((await call(admin.cookie, '/api/knowledge', { id: base.id, published: true }, 'PATCH')).status, 409);
  await db.document.update({ where: { id: original.id }, data: { status: 'ready', embeddingModel: embeddingProfile, chunkCount: 1 } });
  assert.equal((await call(user.cookie, `/api/documents/${original.id}?chunkId=${original.chunks[0].id}`)).status, 404);
  assert.equal((await call(admin.cookie, '/api/knowledge', { id: base.id, published: true }, 'PATCH')).status, 200);
  assert.equal((await call(user.cookie, `/api/documents/${original.id}?chunkId=${original.chunks[0].id}`)).status, 200);
  assert.equal((await call(admin.cookie, `/api/documents/${original.id}`, { action: 'move', knowledgeBaseId: base.id }, 'PATCH')).status, 409);
  assert.equal((await call(admin.cookie, '/api/knowledge', { id: base.id, published: false }, 'PATCH')).status, 200);
  assert.equal((await call(user.cookie, `/api/documents/${original.id}?chunkId=${original.chunks[0].id}`)).status, 404);
  checks.push('publication requires readiness and unpublication revokes source access');
  const adminHtml = await (await call(admin.cookie, '/admin')).text(); assert.ok(!adminHtml.includes('disabled-')); checks.push('admin page does not serialize password fields');
  report.status = 'passed';
}
void main().catch((error) => { report.status = 'failed'; console.error(error instanceof Error ? error.message : 'Check failed'); process.exitCode = 1; }).finally(async () => {
  try { await db.user.deleteMany({ where: { id: { in: ids }, email: { contains: namespace } } }); report.cleanup = 'completed'; } catch { report.cleanup = 'failed'; process.exitCode = 1; }
  await writeFile('reports/knowledge-access-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await db.$disconnect();
});
