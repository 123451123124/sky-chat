import { test, expect } from '@playwright/test';

test('file-processing stages show failures, connection checks and authorized replay',async({page},info)=>{
 let replayed=false;const errors:string[]=[];page.on('pageerror',(e)=>errors.push(e.message));
 await page.route('**/api/**',async(route)=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/knowledge')return route.fulfill({json:{knowledgeBases:[],documents:[]}});
  if(url.pathname==='/api/admin/groups')return route.fulfill({json:{groups:[],users:[]}});
  if(url.pathname==='/api/admin/pipeline'){
   if(route.request().method()==='POST'){expect(route.request().postDataJSON()).toEqual({id:'letter'});replayed=true;return route.fulfill({json:{success:true}});}
   return route.fulfill({json:{searchBackend:'elasticsearch',ingestionBackend:'kafka',pendingEvents:replayed?1:0,failedEvents:replayed?0:1,health:url.searchParams.has('health')?{elasticsearch:true,kafka:true,lag:{parse:0,chunk:0,embed:0,index:0}}:undefined,generations:[{id:'generation',status:replayed?'queued':'failed',stage:'index',progress:80,error:replayed?null:'搜索服务暂时不可用',createdAt:'2026-10-20T00:00:00Z',document:{id:'document',name:'虚构报销手册.md',activeGenerationId:'previous',pendingGenerationId:'generation',knowledgeBase:{published:false}},stages:[{stage:'parse',status:'completed',attempts:1,durationMs:20},{stage:'chunk',status:'completed',attempts:1,durationMs:12},{stage:'embed',status:'completed',attempts:1,durationMs:350},{stage:'index',status:replayed?'pending':'dead',attempts:replayed?0:3,durationMs:null}],deadLetters:replayed?[]:[{id:'letter',stage:'index',message:'搜索服务暂时不可用',attempts:3}]}]}});
  }
  return route.fulfill({json:{}});
 });
 await page.goto('/e2e-chat/rag');await page.getByRole('button',{name:'文件处理',exact:true}).click();
 await expect(page.getByRole('heading',{name:'虚构报销手册.md'})).toBeVisible();await expect(page.getByText('当前已启用的索引仍可使用。')).toBeVisible();
 await page.getByRole('button',{name:'刷新与检查连接'}).click();await expect(page.getByText('检索服务：已连接 · 消息服务：已连接')).toBeVisible();
 await page.screenshot({path:`reports/screenshots/kafka-pipeline-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'重试失败阶段',exact:true}).click();await expect(page.getByRole('status')).toContainText('已从失败阶段重新排队');await expect(page.getByRole('button',{name:'重试失败阶段',exact:true})).toHaveCount(0);
 expect(replayed).toBe(true);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('retrieval diagnostics, group inheritance controls and evaluation reports work in each theme', async ({page},info) => {
  const errors:string[]=[];page.on('pageerror',(e) => errors.push(e.message));
  const groups=[{id:'root',name:'计算机学院',parentId:null as string|null,members:[] as Array<{userId:string}>}]; const writes:Record<string,unknown>[]=[];
  await page.route('**/api/**',async (route) => {
    const url=new URL(route.request().url());
    if(url.pathname==='/api/knowledge')return route.fulfill({json:{knowledgeBases:[{id:'kb',name:'教务示例库'}],documents:[]}});
    if(url.pathname==='/api/admin/groups') {
      if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push(body);if(body.action==='create')groups.push({id:'child',name:body.name,parentId:body.parentId,members:[]});if(body.action==='addMember')groups.find((g) => g.id===body.groupId)!.members.push({userId:body.userId});if(body.action==='removeMember')groups.find((g) => g.id===body.groupId)!.members=[];return route.fulfill({json:{success:true}});}
      return route.fulfill({json:{groups,users:[{id:'student',email:'student@example.test'}]}});
    }
    if(url.pathname==='/api/admin/evaluation')return route.fulfill({json:{date:'2026-10-20T00:00:00Z',queryCount:42,dataset:'虚构政策样本',results:{vector:{recallAt5:1,mrr:.96,ndcgAt5:.97,p50Ms:250,p95Ms:320},hybrid:{recallAt5:1,mrr:1,ndcgAt5:1,p50Ms:320,p95Ms:380}},caveat:'仅反映当前固定样本，不代表实际业务准确率。'}});
    if(url.pathname==='/api/admin/retrieval')return route.fulfill({json:{chunks:[{id:'p',name:'教务手册.md',text:'编号 BC-2026-07 的申请须在 14 天内提交。',page:2,heading:null,matchedChunkIds:['child'],fusionScore:.02,rerankScore:.9}],diagnostics:{mode:'rerank',vectorCandidates:10,keywordCandidates:8,fusedCandidates:14,rerank:{status:'applied',model:'qwen3-rerank'},timings:{embeddingMs:12,vectorMs:20,keywordMs:16,fusionMs:1,rerankMs:200,totalMs:235},embeddingCacheHits:1,filters:{documentCount:1,tags:[]},expandedParents:1}}});
    return route.fulfill({json:{}});
  });
  await page.goto('/e2e-chat/rag');await page.getByLabel('实验检索问题').fill('编号 BC-2026-07 的申请期限？');await page.getByRole('button',{name:'开始检索'}).click();
  await expect(page.getByText('编号 BC-2026-07 的申请须在 14 天内提交。',{exact:true})).toBeVisible();
  await expect(page.getByText(/向量 10 · 全文 8/)).toBeVisible();await expect(page.getByText('235 ms',{exact:true})).toBeVisible();
  await page.screenshot({path:`reports/screenshots/rag-workbench-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'切换暗色模式'}).click();await page.screenshot({path:`reports/screenshots/rag-workbench-dark-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'用户组与成员',exact:true}).click();await page.getByLabel('新用户组名称').fill('前端课题组');await page.getByLabel('上级用户组').selectOption('root');await page.getByRole('button',{name:'创建用户组',exact:true}).click();
  await expect(page.getByLabel('成员管理用户组').locator('option[value=child]')).toHaveCount(1);await page.getByLabel('成员管理用户组').selectOption('child');await page.getByLabel('添加成员账号').selectOption('student');await page.getByRole('button',{name:'添加成员',exact:true}).click();
  await expect(page.locator('.sky-member-list')).toContainText('student@example.test');await page.getByRole('button',{name:'移除组成员：student'}).click();await expect(page.locator('.sky-member-list li')).toHaveCount(0);
  await page.getByRole('button',{name:'评测结果',exact:true}).click();await expect(page.getByRole('heading',{name:'固定样本策略对比'})).toBeVisible();
  expect(writes.map((w) => w.action)).toEqual(['create','addMember','removeMember']);expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('document preview, access restrictions and processing strategy can be inspected without raw vectors', async ({page},info) => {
  const writes:Record<string,unknown>[]=[];let visibility='public';let strategy='recursive';let versionUploaded=false;
  const doc={id:'doc',name:'课程手册.md',knowledgeBaseId:'kb',status:'ready',size:100,chunkCount:1,createdAt:'2026-10-20T00:00:00Z',revision:1,visibility:'inherit',tags:[],groupGrants:[],userGrants:[]};
  await page.route('**/api/**',async (route) => {
    const url=new URL(route.request().url());
    if(url.pathname==='/api/documents' && route.request().method()==='POST'){versionUploaded=route.request().postData()?.includes('name="replacesId"') || false;return route.fulfill({status:202,json:{documentId:'new-version'}});}
    if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();writes.push(body);if(body.action==='configure'){visibility=body.visibility;strategy=body.chunkingStrategy;}return route.fulfill({json:{success:true}});}
    if(url.pathname==='/api/knowledge')return route.fulfill({json:{knowledgeBases:[{id:'kb',name:'教学资料',published:false,visibility,chunkingStrategy:strategy}],documents:[doc]}});
    if(url.pathname==='/api/admin/groups')return route.fulfill({json:{groups:[{id:'g',name:'课题组'}],users:[{id:'u',email:'member@example.test'}]}});
    if(url.searchParams.has('preview'))return route.fulfill({json:{total:2,chunks:[{id:'p',ordinal:0,kind:'parent',text:'课程退选与申请流程的完整上下文。',heading:'课程',page:null,parentId:null},{id:'c',ordinal:1,kind:'leaf',text:'退选申请须在 14 天内提交。',heading:'课程',page:null,parentId:'p'}],detail:{job:{status:'completed',attempts:1},ingestionMetrics:{embedding:{requests:1,cacheHits:2,retries:0}}}}});
    if(url.searchParams.has('versions'))return route.fulfill({json:{versions:[{id:'doc',name:doc.name,revision:1,isCurrent:true,status:'ready'}]}});
    return route.fulfill({json:{}});
  });
  await page.goto('/e2e-chat/manage');await page.getByText('访问范围与分块策略',{exact:true}).click();await page.getByLabel('发布后可见范围').selectOption('group');await page.getByLabel('知识库授权用户组').selectOption('g');await page.getByLabel('分块策略',{exact:true}).selectOption('semantic');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.getByRole('button',{name:doc.name,exact:true}).click();const dialog=page.getByRole('dialog',{name:'文档检查'});await expect(dialog.getByText('退选申请须在 14 天内提交。',{exact:true})).toBeVisible();await page.screenshot({path:`reports/screenshots/rag-chunk-preview-${info.project.name}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'访问与标签'}).click();await dialog.getByLabel('文件访问范围').selectOption('restricted');await dialog.getByLabel('文件授权账号').selectOption('u');await dialog.getByLabel('文件检索标签').fill('课程,2026');await dialog.getByRole('button',{name:'保存文件设置'}).click();await expect(dialog.getByRole('status')).toContainText('文件访问设置已保存');
  await dialog.getByRole('button',{name:'版本记录'}).click();await expect(dialog.getByText(/版本 1 ·/)).toBeVisible();await dialog.getByRole('button',{name:'关闭文档检查'}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:`上传新版本：${doc.name}`}).click();await(await chooser).setFiles({name:'新版课程.md',mimeType:'text/markdown',buffer:Buffer.from('新的课程说明。')});await expect.poll(() => versionUploaded).toBe(true);
  expect(writes[0]).toMatchObject({action:'configure',visibility:'group',groupIds:['g'],chunkingStrategy:'semantic'});expect(writes[1]).toMatchObject({action:'permissions',visibility:'restricted',userIds:['u'],tags:['课程','2026']});
});
