import { test, expect, type Page } from '@playwright/test';

const sse = (text: string, finish = true) => [
  {type:'text-start',id:'answer'}, {type:'text-delta',id:'answer',delta:text},
  ...(finish ? [{type:'text-end',id:'answer'},{type:'finish'}] : []),
].map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');

async function setup(page: Page) {
  const calls = { creates: 0, lists: 0, deletes: 0, chats: 0, saves: [] as Record<string, unknown>[] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/session' && request.method() === 'POST') {
      calls.creates++;
      const body = request.postDataJSON();
      await route.fulfill({json:{id:`new-${calls.creates}`,title:body.title,updatedAt:new Date().toISOString(),_count:{messages:body.messages.length},messages:body.messages.map((message: object,index: number)=>({...message,id:`saved-${index}`}))}});
    } else if (url.pathname === '/api/session') { calls.lists++; await route.fulfill({json:[]}); }
    else if (url.pathname.startsWith('/api/session/') && request.method() === 'DELETE') { calls.deletes++; await route.fulfill({json:{success:true}}); }
    else if (url.pathname === '/api/message' && request.method() === 'POST') {
      const body = request.postDataJSON(); calls.saves.push(body);
      await route.fulfill({json:{...body,id:body.replaceMessageId || `saved-answer-${calls.saves.length}`}});
    } else if (url.pathname === '/api/message') {
      const sid = url.searchParams.get('sessionId');
      await route.fulfill({json:[{id:`${sid}-user`,role:'user',content:`${sid} 的问题`},{id:`${sid}-answer`,role:'assistant',content:`${sid} 的历史回答`}]});
    } else if (url.pathname === '/api/chat') { calls.chats++; await route.fulfill({contentType:'text/event-stream',body:sse('这是测试回复。')}); }
    else await route.fulfill({json:{ok:true}});
  });
  await page.goto('/e2e-chat');
  await expect(page.getByRole('heading',{name:'今天，想聊点什么？'})).toBeVisible();
  return calls;
}
async function openSidebar(page: Page) {
  const opener = page.getByRole('button',{name:'打开侧栏'});
  if (await opener.isVisible()) await opener.click();
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox',{name:'输入消息'}).fill(text);
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
}

test('progressive streaming follows the bottom, preserves reading position and resumes on demand', async ({ page }) => {
  await setup(page);
  await page.route('**/api/chat', (route) => route.continue({ url: 'http://127.0.0.1:3101/e2e-chat/stream' }));
  await send(page, '请持续输出长回复');
  const viewport = page.getByRole('region', { name: '聊天记录' });
  const position = () => viewport.evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.clientHeight - el.scrollTop, height: el.scrollHeight, viewportHeight: el.clientHeight }));
  await expect.poll(async () => (await position()).height / (await position()).viewportHeight).toBeGreaterThan(2);
  const composerTop = await page.locator('.sky-composer').evaluate((el) => el.getBoundingClientRect().top);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(120); expect((await position()).gap).toBeLessThan(8); }
  await viewport.dispatchEvent('wheel', { deltaY: -450 });
  await viewport.evaluate((el) => { el.scrollTop -= 450; });
  await expect(page.getByRole('button', { name: '滚动到最新' })).toBeVisible();
  const reading = await position();
  await page.waitForTimeout(700);
  expect(Math.abs((await position()).top - reading.top)).toBeLessThan(3);
  expect((await position()).height).toBeGreaterThan(reading.height);
  await page.getByRole('button', { name: '滚动到最新' }).click();
  await expect.poll(async () => (await position()).gap).toBeLessThan(8);
  await expect(page.getByRole('textbox', { name: '输入消息' })).toBeEnabled({ timeout: 15000 });
  expect((await position()).gap).toBeLessThan(8);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(Math.abs(await page.locator('.sky-composer').evaluate((el) => el.getBoundingClientRect().top) - composerTop)).toBeLessThan(3);
});

test('preview works without credentials, adapts to mobile, and supports dark mode', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error)=>errors.push(error.message));
  await page.goto('/preview');
  await page.getByRole('heading',{name:'今天，想聊点什么？'}).waitFor();
  await expect(page.getByRole('button',{name:'打开侧栏'})).toBeVisible({visible:info.project.name==='mobile'});
  await page.getByRole('button',{name:'排查代码'}).click();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toHaveValue(/编程问题/);
  await page.getByRole('textbox',{name:'输入消息'}).fill('');
  await page.screenshot({path:`reports/screenshots/${info.project.name}-light.png`,fullPage:true,animations:"disabled"});
  await page.getByRole('button',{name:'切换暗色模式'}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({path:`reports/screenshots/${info.project.name}-dark.png`,fullPage:true,animations:"disabled"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await send(page,'预览问题');
  await expect(page.getByRole('alert').filter({hasText:'这是界面预览'})).toHaveText(/界面预览/);
  await expect(page.getByRole('textbox',{name:'输入消息'})).toHaveValue('预览问题');
  if (info.project.name==='mobile') {
    await openSidebar(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'关闭侧栏'}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button',{name:'打开侧栏'})).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('two turns create one session, save both answers, and reuse server sessions', async ({page}) => {
  const calls = await setup(page);
  await send(page,'第一个问题');
  await expect(page.getByText('这是测试回复。',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await send(page,'第二个问题');
  await expect(page.getByText('这是测试回复。',{exact:true})).toHaveCount(2);
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  expect(calls.creates).toBe(1); expect(calls.lists).toBe(0);
  expect(calls.saves.filter((message)=>message.role==='assistant')).toHaveLength(2);
  expect(calls.saves.filter((message)=>message.role==='user')).toHaveLength(1);
});

test('Chinese composition does not send early, and Shift+Enter inserts a line break', async ({page}) => {
  const calls = await setup(page);
  const input = page.getByRole('textbox',{name:'输入消息'});
  await input.fill('中文输入');
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',bubbles:true});
  expect(calls.creates).toBe(0);
  await input.dispatchEvent('compositionend');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('中文输入\n');
  expect(calls.creates).toBe(0);
  await input.press('Enter');
  await expect(page.getByText('这是测试回复。',{exact:true})).toBeVisible();
  expect(calls.creates).toBe(1);
});

test('stop cancels a pending reply and retains the conversation', async ({page}) => {
  await setup(page);
  await send(page,'已有的问题');
  await expect(page.getByText('这是测试回复。',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve)=>{release=resolve;});
  let intercepted = false;
  await page.route('**/api/chat',async (route)=>{intercepted=true;await gate;await route.abort().catch(()=>{});});
  await send(page,'等待回复的问题');
  await expect.poll(()=>intercepted).toBe(true);
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  release();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await expect(page.getByRole('main').getByText('已有的问题',{exact:true})).toBeVisible();
  await expect(page.getByText('这是测试回复。',{exact:true})).toBeVisible();
  await expect(page.getByText('等待回复的问题',{exact:true})).toBeVisible();
});

test('an interrupted stream preserves partial output and retry replaces the saved answer', async ({page}) => {
  const calls = await setup(page);
  let attempt = 0;
  await page.route('**/api/chat',async(route)=>{attempt++;await route.fulfill({contentType:'text/event-stream',body:sse(attempt===1?'未完成的回复':'重试成功的回复',attempt!==1)});});
  await send(page,'请回答');
  await expect(page.getByRole('alert').filter({hasText:'连接中断'})).toContainText('连接中断');
  await expect(page.getByText('未完成的回复',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByText('重试成功的回复',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  expect(calls.saves.filter((message)=>message.role==='assistant')).toHaveLength(2);
  expect(calls.saves.at(-1)?.replaceMessageId).toBe('saved-answer-1');
});

test('history uses preloaded sessions and deletes an active conversation exactly once', async ({page}) => {
  const calls = await setup(page);
  await openSidebar(page);
  await page.getByRole('button',{name:'测试对话一',exact:true}).click();
  await expect(page.getByText('s1 的历史回答',{exact:true})).toBeVisible();
  await openSidebar(page);
  page.on('dialog',(dialog)=>void dialog.accept());
  await page.getByRole('button',{name:'删除对话：测试对话一',exact:true}).click();
  await expect(page.getByRole('heading',{name:'今天，想聊点什么？'})).toBeVisible();
  expect(calls.deletes).toBe(1); expect(calls.lists).toBe(0);
});

test('failed deletion keeps the session and displays an actionable error', async ({page}) => {
  await setup(page);
  await page.route('**/api/session/s1',route=>route.fulfill({status:500,json:{error:'failed'}}));
  await openSidebar(page);
  page.on('dialog',(dialog)=>void dialog.accept());
  await page.getByRole('button',{name:'删除对话：测试对话一',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'删除失败'})).toContainText('删除失败');
  await expect(page.getByRole('button',{name:'测试对话一',exact:true})).toBeVisible();
});

test('changing conversations cancels a stale history response', async ({page}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve)=>{release=resolve;});
  let intercepted = false;
  await page.route('**/api/message?sessionId=s1',async(route)=>{intercepted=true;await gate;await route.fulfill({json:[{id:'old',role:'assistant',content:'迟到的旧内容'}]}).catch(()=>{});});
  await openSidebar(page);
  await page.getByRole('button',{name:'测试对话一',exact:true}).click();
  await expect.poll(()=>intercepted).toBe(true);
  await openSidebar(page);
  await page.getByRole('button',{name:'测试对话二',exact:true}).click();
  await expect(page.getByText('s2 的历史回答',{exact:true})).toBeVisible();
  release();
  await expect(page.getByText('迟到的旧内容',{exact:true})).toHaveCount(0);
});

test('search filters locally, branching preserves the original, and export downloads Markdown', async ({page}, info) => {
  const calls = await setup(page);
  await openSidebar(page);
  await page.getByRole('textbox',{name:'搜索历史对话'}).fill('对话二');
  await expect(page.getByRole('button',{name:'测试对话一',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'测试对话二',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'清除搜索'}).click();
  if (info.project.name==='mobile') await page.getByRole('button',{name:'关闭侧栏'}).click();
  await send(page,'分支测试');
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await expect(page.getByText('这是测试回复。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已创建分支对话'})).toBeVisible();
  expect(calls.creates).toBe(2);
  await send(page,'分支里的新问题');
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  expect(calls.creates).toBe(2);
  expect(calls.saves.filter((message)=>message.role==='user').at(-1)?.sessionId).toBe('new-2');
  expect(calls.deletes).toBe(0);
  if (info.project.name==='desktop') {
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'导出对话',exact:true}).click();
    expect((await download).suggestedFilename()).toMatch(/^SkyChat-.*\.md$/);
  }
});

test('home, authentication validation, and protected routes remain accessible', async ({page}, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/想法，值得\s*聊一聊。/})).toBeVisible();
  await page.screenshot({path:`reports/screenshots/${info.project.name}-home.png`,fullPage:true,animations:'disabled'});
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('邮箱地址')).toBeVisible();
  await page.screenshot({path:`reports/screenshots/${info.project.name}-login.png`,fullPage:true,animations:'disabled'});
  await page.goto('/register');
  await page.getByLabel('怎么称呼你').fill('测试用户');
  await page.getByLabel('邮箱地址').fill('test@example.test');
  await page.getByLabel('密码',{exact:true}).fill('sample123');
  await page.getByLabel('确认密码',{exact:true}).fill('different123');
  await page.getByRole('button',{name:'创建账号',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'两次密码'})).toHaveText('两次密码输入不一致');
});

test('workspace controls and authentication feedback remain readable in each theme', async ({page}, info) => {
  await setup(page);
  const review = '.impeccable/review';
  const desktop = info.project.name === 'desktop';
  if (desktop) await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:`${review}/${desktop ? 'desktop' : 'mobile'}.png`,fullPage:true,animations:'disabled'});
  const model = page.getByRole('button',{name:'Qwen3.7 Plus',exact:true});
  await model.click();
  await expect(page.getByLabel('选择模型')).toBeVisible();
  await page.screenshot({path:`${review}/${info.project.name}-model-menu.png`,fullPage:true,animations:'disabled'});
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('选择模型')).not.toBeVisible();
  await page.getByRole('button',{name:'排查代码',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeFocused();
  await expect(page.getByRole('button',{name:'排查代码',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.route('**/api/chat', route=>route.fulfill({contentType:'text/event-stream',body:sse('可以从状态更新的时机入手排查。\n\n1. 确认输入是否发生变化。\n2. 检查依赖和清理逻辑。\n\n```tsx\nuseEffect(() => {\n  document.title = title;\n}, [title]);\n```\n\n> 检查依赖，保留问题发生时的输入。\n\n把相关代码和预期结果发给我，我们继续看。')}));
  await send(page,'这段 React 代码为什么没有及时更新？');
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await expect(page.getByText('把相关代码和预期结果发给我，我们继续看。')).toBeVisible();
  await page.getByRole('textbox',{name:'输入消息'}).fill('我想补充一些细节');
  await page.screenshot({path:`${review}/${info.project.name}-conversation-light.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'切换暗色模式'}).click();
  const codeContrast = await page.locator('.markdown-body pre code').evaluate(code => {
    const channels = (color: string) => (color.match(/[\d.]+/g) || []).slice(0,3).map(Number);
    const luminance = (color: string) => channels(color).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((total,value,index) => total + value * [.2126,.7152,.0722][index], 0);
    const background = luminance(getComputedStyle(code.closest('pre')!).backgroundColor);
    return [code,...code.querySelectorAll('span')].map(node => {
      const foreground = luminance(getComputedStyle(node).color);
      return (Math.max(foreground,background) + .05) / (Math.min(foreground,background) + .05);
    });
  });
  expect(Math.min(...codeContrast)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('.sky-quote')).toHaveCSS('border-left-width','1px');
  await page.screenshot({path:`${review}/${info.project.name}-conversation-dark.png`,fullPage:true,animations:'disabled'});
  if (!desktop) {
    await page.getByRole('button',{name:'更多对话操作'}).click();
    await page.screenshot({path:`${review}/mobile-conversation-actions.png`,fullPage:true,animations:'disabled'});
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'导出对话',exact:true}).click();
    expect((await download).suggestedFilename()).toMatch(/^SkyChat-.*\.md$/);
    await expect(page.getByRole('button',{name:'更多对话操作'})).toHaveAttribute('aria-expanded','false');
    await openSidebar(page);
    await page.screenshot({path:`${review}/mobile-drawer.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'关闭侧栏'}).click();
  } else {
    await page.setViewportSize({width:762,height:938});
    await page.screenshot({path:`${review}/user-762.png`,fullPage:true,animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({width:1280,height:800});
    await page.screenshot({path:`${review}/desktop-1280.png`,fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:1440,height:900});
  }
  await openSidebar(page);
  await page.getByRole('button',{name:'开启新对话',exact:true}).click();
  await page.getByRole('button',{name:'切换亮色模式'}).click();
  const toolEvents = [
    {type:'reasoning-start',id:'reason'},
    {type:'reasoning-delta',id:'reason',delta:'界面测试示例：先确认任务，再检查可用工具。'},
    {type:'reasoning-end',id:'reason'},
    {type:'tool-input-start',toolCallId:'demo-ok',toolName:'generateImage'},
    {type:'tool-input-available',toolCallId:'demo-ok',toolName:'generateImage',input:{prompt:'界面测试示例'}},
    {type:'tool-output-available',toolCallId:'demo-ok',output:{message:'示例成功状态，未执行真实调用。'}},
    {type:'tool-input-start',toolCallId:'demo-error',toolName:'generateImage'},
    {type:'tool-output-error',toolCallId:'demo-error',errorText:'示例失败状态，可调整后重试。'},
    {type:'text-start',id:'answer'},
    {type:'text-delta',id:'answer',delta:'以上仅为工具状态的界面测试。'},
    {type:'text-end',id:'answer'}, {type:'finish'},
  ].map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join('');
  await page.route('**/api/chat',route=>route.fulfill({contentType:'text/event-stream',body:toolEvents}));
  await send(page,'查看工具状态示例');
  await expect(page.getByRole('textbox',{name:'输入消息'})).toBeEnabled();
  await expect(page.getByText('以上仅为工具状态的界面测试。',{exact:true})).toBeVisible();
  await page.screenshot({path:`${review}/${info.project.name}-tool-states-light.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'切换暗色模式'}).click();
  await page.screenshot({path:`${review}/${info.project.name}-tool-states-dark.png`,fullPage:true,animations:'disabled'});
  await page.goto('/login');
  await page.getByLabel('邮箱地址').fill('test@example.test');
  await page.getByLabel('密码',{exact:true}).fill('sample-password');
  let release = () => {};
  const pending = new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/auth/login',async route=>{await pending;await route.fulfill({status:401,json:{error:'邮箱或密码不正确，请检查后重试。'}});});
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'正在登录…'})).toBeDisabled();
  release();
  await expect(page.getByRole('alert').filter({hasText:'邮箱或密码不正确'})).toBeVisible();
  await expect(page.getByLabel('邮箱地址')).toHaveValue('test@example.test');
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeEnabled();
  await page.screenshot({path:`${review}/${info.project.name}-login-error-dark.png`,fullPage:true,animations:'disabled'});
});
