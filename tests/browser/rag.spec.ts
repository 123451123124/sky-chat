import { test, expect, type Page } from '@playwright/test';
import type { RagTrace } from '../../lib/rag/types';

const id = '11111111-1111-4111-8111-111111111111';
const trace: RagTrace = { runId: '22222222-2222-4222-8222-222222222222', question: '资料里的保留期是多少？', status: 'completed', steps: [{ id: 'step-1', tool: 'searchKnowledge', query: '保留期', status: 'completed', durationMs: 18, sourceIds: ['S1'] }], sources: [{ id: 'S1', documentId: id, chunkId: '33333333-3333-4333-8333-333333333333', name: '公开示例.md', page: null, heading: '保留期', excerpt: '示例项目的日志保留期为 17 天。', score: .8, stepIds: ['step-1'] }], citedSourceIds: ['S1'], invalidCitationCount: 0 };
const answer = `保留期为 17 天。[S1](#rag-${trace.runId}-S1)`;
const stream = [{ type: 'rag-trace', trace: { ...trace, status: 'running' } }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: answer }, { type: 'text-end', id: 'text' }, { type: 'text-replace', text: answer }, { type: 'rag-trace', trace }, { type: 'finish' }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

async function setup(page: Page, existing = false) {
  const calls = { chats: [] as Record<string, unknown>[], selection: [] as string[], creates: [] as Record<string, unknown>[], errors: [] as string[] };
  page.on('pageerror', (error) => calls.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') calls.errors.push(message.text()); });
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    const document = { id, name: '公开示例.md', size: 100, status: 'ready', error: null, chunkCount: 1, knowledgeBaseId: 'base', createdAt: new Date().toISOString() };
    if (url.pathname === '/api/knowledge') await route.fulfill({ json: { documents: [document], knowledgeBases: [{ id: 'base', name: '公开资料' }], selectedIds: existing ? [id] : [] } });
    else if (url.pathname === '/api/upload') await route.fulfill({ status: 202, json: { documentId: id, fileName: document.name, fileSize: 100 } });
    else if (url.pathname.startsWith('/api/documents/')) await route.fulfill({ json: url.searchParams.has('chunkId') ? { document, chunk: { text: '真实原文：示例项目的日志保留期为 17 天。' } } : { document } });
    else if (url.pathname === '/api/session' && request.method() === 'POST') {
      const body = request.postDataJSON(); calls.creates.push(body);
      await route.fulfill({ json: { id: 'rag-session', title: body.title, updatedAt: new Date().toISOString(), _count: { messages: body.messages.length }, messages: body.messages.map((m: object, i: number) => ({ ...m, id: `saved-${i}` })) } });
    } else if (url.pathname.endsWith('/documents') && request.method() === 'PUT') { calls.selection = request.postDataJSON().documentIds; await route.fulfill({ json: { selectedIds: calls.selection } }); }
    else if (url.pathname === '/api/message' && request.method() === 'GET') await route.fulfill({ json: [{ id: 'u', role: 'user', content: '之前的问题', parts: [] }, { id: 'a', role: 'assistant', content: answer, parts: [{ type: 'text', text: answer }, { type: 'rag', trace }] }] });
    else if (url.pathname === '/api/message') await route.fulfill({ json: { id: 'saved-answer' } });
    else if (url.pathname === '/api/chat') { calls.chats.push(request.postDataJSON()); await route.fulfill({ contentType: 'text/event-stream', body: stream }); }
    else await route.fulfill({ json: { success: true } });
  });
  await page.goto('/e2e-chat');
  return calls;
}
async function ask(page: Page, text = '资料里的保留期是多少？') { await page.getByRole('textbox', { name: '输入消息' }).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(page.getByRole('textbox', { name: '输入消息' })).toBeEnabled(); }

test('chat selects published documents and retains RAG scope without upload controls', async ({ page }) => {
  const calls = await setup(page);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.getByRole('button', { name: '文件与知识库', exact: true }).click();
  await page.getByRole('dialog', { name: '文件与知识库' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '完成选择' }).click();
  await ask(page);
  await expect(page.getByRole('button', { name: 'S1', exact: true })).toBeVisible();
  expect(calls.creates[0].documentIds).toEqual([id]);
  expect(JSON.stringify(calls.chats[0])).not.toContain('RAW_FILE_CONTENT');
  expect(calls.chats[0].sessionId).toBe('rag-session');
  await ask(page, '能再解释一下吗？');
  expect(calls.selection).toEqual([id]);
  expect(calls.chats).toHaveLength(2);
});

test('source list, original snippets, 3D scene and mobile layout stay linked', async ({ page }, info) => {
  const calls = await setup(page);
  await ask(page);
  await page.getByRole('button', { name: 'S1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '检索路径与原文', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('真实原文：示例项目的日志保留期为 17 天。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '3D 关系', exact: true }).click();
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 20000 });
  await expect(dialog.locator('canvas')).toHaveAttribute('data-source-graph-ready', 'true');
  await expect.poll(() => dialog.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0);
  await page.screenshot({ path: `reports/screenshots/rag-source-${info.project.name}.png`, animations: 'disabled' });
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
  await dialog.getByRole('button', { name: '关闭来源视图' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'S1', exact: true }).click();
  await expect(dialog.locator('canvas')).toBeVisible();
  await expect(dialog.locator('canvas')).toHaveAttribute('data-source-graph-ready', 'true');
  await dialog.getByRole('button', { name: '关闭来源视图' }).click();
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
  await page.getByRole('button', { name: 'S1', exact: true }).click();
  await expect(dialog.locator('canvas')).toBeVisible();
  await expect(dialog.locator('canvas')).toHaveAttribute('data-source-graph-ready', 'true');
  await page.screenshot({ path: `reports/screenshots/rag-source-dark-${info.project.name}.png`, animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭来源视图' }).click();
  await expect(page.getByRole('textbox', { name: '输入消息' })).toBeEnabled();
  expect(calls.errors).toEqual([]);
});

test('documents selected in a saved conversation are restored before sending', async ({ page }, info) => {
  const calls = await setup(page, true);
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开侧栏' }).click();
  await page.getByRole('button', { name: '测试对话一', exact: true }).click();
  await expect(page.getByText('正在使用 1 个文件回答', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文件与知识库', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '文件与知识库' }).getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '完成选择' }).click();
  await ask(page, '追问');
  expect(calls.chats[0].sessionId).toBe('s1');
  expect(calls.selection).toEqual([id]);
});

test('WebGL failure falls back to usable original-source lists', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await setup(page); await ask(page);
  await page.getByRole('button', { name: 'S1', exact: true }).click();
  await page.getByRole('button', { name: '3D 关系', exact: true }).click();
  await expect(page.getByText('当前设备无法显示 3D，仍可使用下方来源列表。', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('真实原文：示例项目的日志保留期为 17 天。', { exact: true })).toBeVisible();
});
