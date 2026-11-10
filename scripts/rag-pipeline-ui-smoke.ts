import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {SignJWT} from 'jose';
import {chromium} from '@playwright/test';
import {prisma} from '../lib/prisma';
import {enqueueGeneration} from '../lib/rag/messaging/enqueue';
import {storeFile,removeFile} from '../lib/rag/storage';
import {removeArtifacts} from '../lib/rag/pipeline/artifacts';
import {elastic} from '../lib/rag/search/client';
import {esConfig} from '../lib/rag/search/config';
import {searchKnowledgeDetailed} from '../lib/rag/retrieval';

const namespace=randomUUID(),documentId=randomUUID();let userId:string|undefined,generationId:string|undefined;
const checks:string[]=[];const report:Record<string,unknown>={date:new Date().toISOString(),status:'running',checks};
async function main(){
 const user=await prisma.user.create({data:{email:`pipeline-ui-${namespace}@example.test`,name:'界面验证',role:'admin',password:`disabled-${namespace}`}});userId=user.id;
 const kb=await prisma.knowledgeBase.create({data:{userId:user.id,name:'文件处理验证资料'}});
 const text='# 示例资料\n文件上传后依次完成解析、分块、向量化与检索索引。本文件是临时验证资料，结束后自动清理。';
 await storeFile(documentId,Buffer.from(text));
 generationId=(await prisma.$transaction(async(tx)=>{await tx.document.create({data:{id:documentId,userId:user.id,knowledgeBaseId:kb.id,name:'文件处理示例.md',mediaType:'text/plain',size:Buffer.byteLength(text),hash:createHash('sha256').update(text).digest('hex')}});return enqueueGeneration(tx,documentId);})).id;
 for(let i=0;i<200;i++){const gen=await prisma.ragGeneration.findUniqueOrThrow({where:{id:generationId}});if(gen.status==='ready')break;assert.notEqual(gen.status,'failed');assert.ok(i<199,'Pipeline timed out');await delay(1000);}
 const indexed=await elastic().count({index:esConfig.index,query:{term:{generationId}}});assert.ok(indexed.count>0);checks.push('final worker completes real four-stage ingestion through the bulk helper');
 const retrieved=await searchKnowledgeDetailed(user.id,[documentId],'文件上传后的处理步骤',AbortSignal.timeout(30000));assert.equal(retrieved.diagnostics.mode,'hybrid_rescore');assert.equal(retrieved.diagnostics.rerank.status,'disabled');assert.ok(retrieved.chunks.length);checks.push('default chat retrieval uses hybrid Rescore without an unnecessary rerank model call');
 const token=await new SignJWT({userId:user.id,email:user.email,role:'admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('15m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'sky-chat-token',value:token,url:'http://127.0.0.1:3100'}]);
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e)=>errors.push(e.message));
  const initialGroups=page.waitForResponse((r)=>r.url().endsWith('/api/admin/groups'));
  const initialKnowledge=page.waitForResponse((r)=>r.url().endsWith('/api/knowledge?manage=1'));
  await page.goto('http://127.0.0.1:3100/admin/rag');await Promise.all((await Promise.all([initialGroups,initialKnowledge])).map((r)=>r.finished()));await page.getByRole('button',{name:'文件处理',exact:true}).click();await page.waitForSelector('.sky-pipeline-runs article');
  const states=await page.locator('.sky-pipeline-stages dd').allTextContents();assert.equal(states.length,4);assert.ok(states.every((s)=>s.includes('已完成')));
  await prisma.user.update({where:{id:user.id},data:{role:'user'}});
  await page.getByRole('alert').filter({hasText:'仅管理员可查看处理记录'}).waitFor({timeout:20000});assert.equal(await page.locator('.sky-pipeline-runs').count(),0);
  checks.push('role revocation clears previously loaded pipeline records with the original JWT');
  await prisma.user.update({where:{id:user.id},data:{role:'admin'}});
  await page.waitForSelector('.sky-pipeline-runs article',{timeout:20000});await page.locator('section[aria-label="文件处理记录"]').getByRole('alert').waitFor({state:'hidden',timeout:10000});
  checks.push('polling recovery clears stale errors and restores authorized records');
  await page.getByRole('button',{name:'刷新与检查连接',exact:true}).click();await page.waitForSelector('.sky-pipeline-health');
  await page.screenshot({path:'reports/screenshots/kafka-pipeline-real-desktop.png',animations:'disabled',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'reports/screenshots/kafka-pipeline-real-mobile.png',animations:'disabled',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
  checks.push('production desktop/mobile layout has no horizontal overflow or page errors');
 }finally{await browser.close();}
 report.status='passed';
}
void main().catch((e)=>{report.status='failed';report.error=e instanceof Error?e.message:'Unknown failure';process.exitCode=1;}).finally(async()=>{
 try{
  if(generationId)await prisma.ragIndexCleanup.createMany({data:[{generationId,availableAt:new Date(Date.now()+300000)}],skipDuplicates:true});
  if(userId)await prisma.user.deleteMany({where:{id:userId,email:{contains:namespace}}});
  await removeFile(documentId);
  if(generationId){await elastic().deleteByQuery({index:esConfig.index,query:{term:{generationId}},refresh:true,conflicts:'proceed'}).catch(()=>{});await removeArtifacts(generationId);}
  report.cleanup='completed';
 }catch{report.cleanup='failed';process.exitCode=1;}
 await writeFile('reports/rag-pipeline-ui-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await prisma.$disconnect();
});
