import { test, expect } from '@playwright/test';

test('management batches uploads, retries failed files and publishes ready knowledge', async ({ page }, info) => {
  const documents: Record<string, unknown>[] = [];
  let published = false;
  let failure = true;
  let active = 0; let maximum = 0;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/knowledge' && route.request().method() === 'PATCH') { published = route.request().postDataJSON().published; await route.fulfill({ json: { success: true } }); }
    else if (url.pathname === '/api/knowledge') await route.fulfill({ json: { knowledgeBases: [{ id: 'base', name: '产品手册', published }], documents } });
    else if (url.pathname === '/api/documents') {
      active++; maximum = Math.max(maximum, active);
      const name = route.request().postData()?.match(/filename="([^"]+)"/)?.[1] || 'test.txt';
      await new Promise((resolve) => setTimeout(resolve, 80)); active--;
      if (name === 'retry.txt' && failure) { failure = false; await route.fulfill({ status: 503, json: { error: '上传服务临时不可用' } }); }
      else { const document = { id: `file-${documents.length}`, name, knowledgeBaseId: 'base', status: 'ready', size: 120, chunkCount: 2, error: null, createdAt: '2026-10-19T00:00:00Z' }; documents.push(document); await route.fulfill({ status: 202, json: { documentId: document.id } }); }
    } else if (url.pathname.startsWith('/api/documents/') && route.request().method() === 'DELETE') { documents.splice(documents.findIndex((d) => url.pathname.endsWith(String(d.id))), 1); await route.fulfill({ json: { success: true } }); }
    else await route.fulfill({ json: {} });
  });
  await page.goto('/e2e-chat/manage');
  await expect(page.getByRole('heading', { name: '产品手册', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发布知识库', exact: true })).toBeDisabled();
  await page.getByLabel('批量上传知识库文件').setInputFiles(['one.md', 'two.txt', 'retry.txt', 'four.txt'].map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('Synthetic example content') })));
  await expect(page.getByText('上传服务临时不可用', { exact: true })).toBeVisible();
  await expect(page.locator('.sky-document-table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '重试上传失败文件' }).click();
  await expect(page.locator('.sky-document-table tbody tr')).toHaveCount(4);
  expect(maximum).toBeLessThanOrEqual(3);
  await page.locator('.sky-upload-queue summary').click();
  await page.getByRole('button', { name: '清除上传记录' }).click();
  await page.getByRole('button', { name: '发布知识库', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消发布', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '批量上传', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `reports/screenshots/management-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '切换暗色模式' }).click();
  await page.screenshot({ path: `reports/screenshots/management-dark-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '取消发布', exact: true }).click();
  await page.getByLabel('选择当前列表全部文件').check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除所选' }).click();
  await expect(page.locator('.sky-document-table tbody tr')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('admin overview, performance and accounts share the management layout', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/e2e-chat/admin');
  await expect(page.getByRole('heading', { name: '运行概览', exact: true })).toBeVisible();
  await page.screenshot({ path: `reports/screenshots/admin-overview-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '流式性能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '流式性能', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '账号与会话', exact: true }).click();
  await expect(page.getByText('user@example.test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换暗色模式' }).click();
  await page.screenshot({ path: `reports/screenshots/admin-accounts-dark-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('ungrouped historical documents can move into a draft without uploading again', async ({ page }) => {
  const document = { id: 'legacy', name: '历史文件.md', knowledgeBaseId: null as string | null, status: 'ready', size: 100, chunkCount: 3, createdAt: '2026-10-19T00:00:00Z' };
  const moves: object[] = [];
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON(); moves.push(body); document.knowledgeBaseId = body.knowledgeBaseId; await route.fulfill({ json: { success: true } }); }
    else await route.fulfill({ json: { documents: [document], knowledgeBases: [{ id: 'draft', name: '待发布手册', published: false }] } });
  });
  await page.goto('/e2e-chat/manage');
  await page.getByRole('button', { name: /未分组文件/ }).click();
  await expect(page.getByText('历史文件.md', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '批量上传', exact: true })).toHaveCount(0);
  await page.getByLabel('选择当前列表全部文件').check();
  await page.getByLabel('移动目标知识库').selectOption('draft');
  await page.getByRole('button', { name: '移动所选' }).click();
  await expect(page.getByRole('heading', { name: '待发布手册', exact: true })).toBeVisible();
  await expect(page.getByText('历史文件.md', { exact: true })).toBeVisible();
  expect(moves).toEqual([{ action: 'move', knowledgeBaseId: 'draft' }]);
});
