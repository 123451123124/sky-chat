import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SignJWT } from 'jose';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { documentPermissionSql, readableDocuments } from '../lib/rag/access';
import { embedCachedTexts, newEmbeddingStats, clearEmbeddingMemoryCache } from '../lib/rag/embedding';
import { searchKnowledgeDetailed } from '../lib/rag/retrieval';
import { removeFile } from '../lib/rag/storage';
import {esEnabled,esConfig} from '../lib/rag/search/config';
import {embedSearchTexts,clearSearchMemory} from '../lib/rag/search/embedding';
import {elastic} from '../lib/rag/search/client';
import {removeArtifacts} from '../lib/rag/pipeline/artifacts';

const namespace=randomUUID();const users:string[]=[];const groups:string[]=[];const files:string[]=[];const checks:string[]=[];
const report:{status:string;checks:string[];cleanup?:string;error?:string;measurements?:object}={status:'running',checks};
async function actor(role='user') {const user=await prisma.user.create({data:{email:`engine-${randomUUID()}-${namespace}@example.test`,name:'RAG 工程验证',password:`disabled-${randomUUID()}`,role}});users.push(user.id);const token=await new SignJWT({userId:user.id,email:user.email,role}).setProtectedHeader({alg:'HS256'}).setExpirationTime('20m').sign(new TextEncoder().encode(process.env.JWT_SECRET));return{id:user.id,cookie:`sky-chat-token=${token}`};}
async function api(cookie:string,url:string,body?:object,method='POST') {return fetch(`http://127.0.0.1:3100${url}`,{method:body?method:'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});}
async function ok(cookie:string,url:string,body:object,method='POST'){const response=await api(cookie,url,body,method);assert.ok(response.ok,`${url} should succeed (${response.status})`);return response.json();}
async function upload(cookie:string,kb:string,name:string,text:string,replacesId?:string){const form=new FormData();form.append('file',new Blob([text]),name);form.append('knowledgeBaseId',kb);if(replacesId)form.append('replacesId',replacesId);const response=await fetch('http://127.0.0.1:3100/api/documents',{method:'POST',headers:{Cookie:cookie},body:form,signal:AbortSignal.timeout(20000)});assert.equal(response.status,202);const data=await response.json();files.push(data.documentId);return data.documentId as string;}
async function wait(id:string,status='ready'){for(let i=0;i<150;i++){const doc=await prisma.document.findUniqueOrThrow({where:{id},include:{job:true}});if(doc.status===status&&!(status==='ready'&&esEnabled()&&doc.pendingGenerationId))return doc;if(status==='ready'&&doc.status==='failed')throw new Error('Synthetic ingestion failed: '+doc.error);await delay(700);}throw new Error('Worker timeout');}
async function configure(cookie:string,id:string,visibility:string,groupIds:string[],chunkingStrategy='recursive'){return ok(cookie,'/api/knowledge',{action:'configure',id,visibility,groupIds,chunkingStrategy},'PATCH');}
async function permission(cookie:string,id:string,visibility:string,groupIds:string[]=[],userIds:string[]=[],tags:string[]=[]){return ok(cookie,`/api/documents/${id}`,{action:'permissions',visibility,groupIds,userIds,tags},'PATCH');}
async function publish(cookie:string,id:string,published:boolean){return ok(cookie,'/api/knowledge',{id,published},'PATCH');}

async function main(){
 const admin=await actor('admin');const a=await actor();const b=await actor();const c=await actor();const outside=await actor();
 const root=await ok(admin.cookie,'/api/admin/groups',{action:'create',name:'验证学院',parentId:null});groups.push(root.id);
 const labA=await ok(admin.cookie,'/api/admin/groups',{action:'create',name:'验证课题组 A',parentId:root.id});groups.push(labA.id);
 const labB=await ok(admin.cookie,'/api/admin/groups',{action:'create',name:'验证课题组 B',parentId:root.id});groups.push(labB.id);
 for(const [who,groupId] of [[a,labA.id],[b,labB.id],[c,labB.id]] as const)await ok(admin.cookie,'/api/admin/groups',{action:'addMember',userId:who.id,groupId});
 assert.equal((await api(a.cookie,'/api/admin/groups')).status,403);
 const kb=await ok(admin.cookie,'/api/knowledge',{name:'隔离验证库'});await configure(admin.cookie,kb.id,'group',[root.id]);
 const open=await upload(admin.cookie,kb.id,'共享日志.md','# 共享日志\n日志保留期为 17 天。附件限制为 8 MB。');
 const secret=await upload(admin.cookie,kb.id,'私有资料.md','# 私有资料\nPRIVATE-MARKER 不应进入他人召回。日志保留期为 999 天。');
 const restricted=await upload(admin.cookie,kb.id,'限定资料.md','# 限定资料\n团队内部附件限制为 32 MB，编号 GROUP-2026-03。');
 await Promise.all([open,secret,restricted].map((id)=>wait(id)));
 await permission(admin.cookie,secret,'private');await permission(admin.cookie,restricted,'restricted',[labA.id],[c.id,outside.id],['内部']);await publish(admin.cookie,kb.id,true);
 for(const [who,expected] of [[a,[open,restricted]],[b,[open]],[c,[open,restricted]],[outside,[]]] as const){
   const listing=await(await api(who.cookie,'/api/knowledge')).json();assert.deepEqual(listing.documents.filter((d:{id:string})=>files.includes(d.id)).map((d:{id:string})=>d.id).sort(),[...expected].sort());
   const orm=await prisma.document.findMany({where:{...readableDocuments(who.id),id:{in:files}},select:{id:true}});
   const sql=await prisma.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT d.id FROM "Document" d WHERE d.id IN (${Prisma.join(files)}) AND ${documentPermissionSql(who.id)}`);
   assert.deepEqual(orm.map((d)=>d.id).sort(),[...expected].sort());assert.deepEqual(sql.map((d)=>d.id).sort(),[...expected].sort());
 }
 checks.push('hierarchical group inheritance and file-level narrowing match in API, ORM and pre-ranking SQL');
 const session=await ok(a.cookie,'/api/session',{title:'权限与版本验证',documentIds:[open]});
 assert.equal((await api(a.cookie,`/api/session/${session.id}/documents`,{documentIds:[secret]},'PUT')).status,404);
 assert.equal((await api(outside.cookie,`/api/documents/${open}?download=1`)).status,404);
 const ranked=await searchKnowledgeDetailed(a.id,[open,restricted],'附件限制',AbortSignal.timeout(40000),{mode:'rerank',tags:['内部']});
 assert.equal(ranked.diagnostics.rerank.status,'applied');assert.ok(ranked.chunks.length);assert.ok(ranked.chunks.every((d)=>d.documentId===restricted));assert.ok(ranked.chunks.every((d)=>!d.text.includes('PRIVATE-MARKER')));
 checks.push('authorized tag filtering, parent expansion and real neural reranking never expose private candidates');
 await ok(admin.cookie,'/api/admin/groups',{action:'removeMember',userId:a.id,groupId:labA.id});
 assert.equal((await api(a.cookie,`/api/documents/${open}`)).status,404);await ok(admin.cookie,'/api/admin/groups',{action:'addMember',userId:a.id,groupId:labA.id});
 checks.push('membership revocation takes effect immediately without issuing a new JWT');
 await publish(admin.cookie,kb.id,false);await ok(admin.cookie,`/api/documents/${open}`,{action:'reindex'},'PATCH');const rebuilt=await wait(open);
 const metrics=rebuilt.ingestionMetrics as {embedding:{requests:number;cacheHits:number};checkpointReused:boolean};assert.equal(metrics.embedding.requests,0);assert.ok(metrics.embedding.cacheHits>0);assert.equal(metrics.checkpointReused,true);
 checks.push('re-index reuses parser checkpoint and persisted owner-scoped vectors with zero provider requests');
 const failed=await upload(admin.cookie,kb.id,'失败的新版本.pdf','This deliberately is not PDF.',open);const failure=await wait(failed,'failed');assert.equal(failure.job?.status,'dead');assert.equal((await prisma.document.findUniqueOrThrow({where:{id:open}})).isCurrent,true);
 assert.equal((await prisma.document.findUniqueOrThrow({where:{id:failed}})).isCurrent,false);
 await publish(admin.cookie,kb.id,true);assert.equal((await api(a.cookie,`/api/documents/${open}`)).status,200);await publish(admin.cookie,kb.id,false);
 const discarded=await fetch(`http://127.0.0.1:3100/api/documents/${failed}?versionOnly=1`,{method:'DELETE',headers:{Cookie:admin.cookie}});assert.equal(discarded.status,200);assert.ok(await prisma.document.findUnique({where:{id:open}}));
 checks.push('invalid replacement goes to dead letters; previous version remains usable and failed version can be discarded alone');
 const oldChunk=await prisma.chunk.findFirstOrThrow({where:{documentId:open,kind:'leaf'}});
 const updated=await upload(admin.cookie,kb.id,'共享日志-v2.md','# 共享日志\n日志保留期改为 23 天，附件限制为 12 MB。',open);await wait(updated);
 assert.equal((await prisma.document.findUniqueOrThrow({where:{id:open}})).isCurrent,false);
 const refs=await prisma.sessionDocument.findMany({where:{sessionId:session.id}});assert.deepEqual(refs.map((r)=>r.documentId),[updated]);
 await permission(admin.cookie,updated,'private');await publish(admin.cookie,kb.id,true);assert.equal((await api(a.cookie,`/api/documents/${open}?chunkId=${oldChunk.id}`)).status,404);assert.equal((await api(a.cookie,`/api/documents/${updated}`)).status,404);
 await publish(admin.cookie,kb.id,false);await permission(admin.cookie,updated,'inherit');await publish(admin.cookie,kb.id,true);assert.equal((await api(a.cookie,`/api/documents/${open}?chunkId=${oldChunk.id}`)).status,200);
 checks.push('successful version switch is atomic, migrates session scope and keeps old citations; policy changes cover history');
 const first=newEmbeddingStats();const second=newEmbeddingStats();const foreign=newEmbeddingStats();const phrase=`Cache privacy probe ${namespace}`;
 const embed=esEnabled()?embedSearchTexts:embedCachedTexts;const clear=esEnabled()?clearSearchMemory:clearEmbeddingMemoryCache;
 await embed(a.id,[phrase,phrase],AbortSignal.timeout(20000),first);clear(a.id);await embed(a.id,[phrase],AbortSignal.timeout(20000),second);await embed(b.id,[phrase],AbortSignal.timeout(20000),foreign);
 assert.equal(first.requests,1);assert.equal(second.requests,0);assert.equal(second.cacheHits,1);assert.equal(second.databaseHits,1);assert.equal(foreign.requests,1);
 checks.push('embedding deduplication and warm cache work while different owners never share a private cache namespace');
 const semantic=await ok(admin.cookie,'/api/knowledge',{name:'语义分块验证'});await configure(admin.cookie,semantic.id,'private',[],'semantic');
 const text=['# 课程申请\n'+ '课程申请应遵循教学计划，满足学分与先修条件。'.repeat(30),'# 经费管理\n'+'经费报销需要发票和审批，差旅费用按标准核算。'.repeat(30),'# 安全访问\n'+'权限撤销后禁止读取，敏感资料需要指定授权。'.repeat(30)].join('\n');
 const sem=await upload(admin.cookie,semantic.id,'语义分块.md',text);const indexed=await wait(sem);const profile=esEnabled()?(await prisma.ragGeneration.findUniqueOrThrow({where:{id:indexed.activeGenerationId!}})).profile:indexed.pipelineProfile;assert.ok(profile?.includes(':semantic:'));assert.ok(await prisma.chunk.count({where:{documentId:sem,kind:'parent'}})>0);assert.ok(await prisma.chunk.count({where:{documentId:sem,kind:'leaf'}})>0);
 checks.push('semantic embedding boundaries and LangChain recursive child splitting are indexed by the live worker');
 await prisma.user.update({where:{id:admin.id},data:{role:'user'}});assert.equal((await api(admin.cookie,'/api/admin/groups')).status,403);await prisma.user.update({where:{id:admin.id},data:{role:'admin'}});
 checks.push('administrator role revocation is checked from the database instead of stale JWT claims');
 report.measurements={reindexEmbeddingRequests:metrics.embedding.requests,reindexCacheHits:metrics.embedding.cacheHits,rerank:ranked.diagnostics.rerank.status,semanticChunks:indexed.chunkCount};report.status='passed';
}
void main().catch((e)=>{report.status='failed';report.error=e instanceof Error?e.message:'Unknown error';process.exitCode=1;}).finally(async()=>{
 try{const generations=esEnabled()?await prisma.ragGeneration.findMany({where:{documentId:{in:files}},select:{id:true}}):[];if(generations.length)await prisma.ragIndexCleanup.createMany({data:generations.map(({id})=>({generationId:id,availableAt:new Date(Date.now()+300000)})),skipDuplicates:true});await prisma.session.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users},email:{contains:namespace}}});for(const id of [...groups].reverse())await prisma.accessGroup.deleteMany({where:{id}});for(const id of files)await removeFile(id);if(generations.length){await elastic().deleteByQuery({index:esConfig.index,query:{terms:{generationId:generations.map(({id})=>id)}},conflicts:'proceed',refresh:true}).catch(()=>{});for(const {id} of generations)await removeArtifacts(id);}report.cleanup='completed';}catch{report.cleanup='failed';process.exitCode=1;}
 await writeFile(esEnabled()?'reports/rag-es-engine-smoke.json':'reports/rag-engine-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await prisma.$disconnect();
});
