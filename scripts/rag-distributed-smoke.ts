import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../lib/prisma';
import { enqueueGeneration } from '../lib/rag/messaging/enqueue';
import { eventSchema, stageTopic } from '../lib/rag/messaging/contracts';
import { kafka } from '../lib/rag/messaging/client';
import { processPipelineEvent, replayDeadLetter } from '../lib/rag/pipeline/engine';
import { searchKnowledgeDetailed } from '../lib/rag/retrieval';
import { elastic } from '../lib/rag/search/client';
import { esConfig } from '../lib/rag/search/config';
import { storeFile, removeFile } from '../lib/rag/storage';
import { removeArtifacts } from '../lib/rag/pipeline/artifacts';

process.env.RAG_SEARCH_BACKEND='elasticsearch';process.env.RAG_INGESTION_BACKEND='kafka';
const namespace=randomUUID();const users:string[]=[];const files:string[]=[];const generations:string[]=[];const checks:string[]=[];
const report:{date:string;status:string;checks:string[];cleanup?:string;error?:string;measurements?:object;temporaryFileIds:string[];temporaryGenerationIds:string[]}={date:new Date().toISOString(),status:'running',checks,temporaryFileIds:files,temporaryGenerationIds:generations};
const signal=AbortSignal.timeout(600000);
async function wait(id:string,status='ready'){
 for(let i=0;i<240;i++){signal.throwIfAborted();const gen=await prisma.ragGeneration.findUniqueOrThrow({where:{id},include:{stages:true}});if(gen.status===status)return gen;if(gen.status==='failed'&&status==='ready')throw new Error(`Stage ${gen.stage} failed: ${gen.error}`);await delay(750);}throw new Error('Kafka worker timeout');
}
async function document(userId:string,kb:string,name:string,text:string,options:{private?:boolean;expiredLease?:boolean;replacesId?:string}={}){
 const id=randomUUID();await storeFile(id,Buffer.from(text));files.push(id);
 const previous=options.replacesId?await prisma.document.findUniqueOrThrow({where:{id:options.replacesId}}):null;
 const gen=await prisma.$transaction(async(tx)=>{await tx.document.create({data:{id,userId,knowledgeBaseId:kb,name,mediaType:'text/plain',size:Buffer.byteLength(text),hash:createHash('sha256').update(text).digest('hex'),visibility:options.private?'private':'inherit',...(previous?{familyId:previous.familyId,revision:previous.revision+1,isCurrent:false,replacesId:previous.id}:{})}});const next=await enqueueGeneration(tx,id);if(options.expiredLease)await tx.ragStage.update({where:{generationId_stage:{generationId:next.id,stage:'parse'}},data:{status:'running',leaseToken:randomUUID(),leaseUntil:new Date(Date.now()-1000)}});return next;});
 generations.push(gen.id);return{id,generationId:gen.id};
}
async function main(){
 const owner=await prisma.user.create({data:{email:`distributed-owner-${namespace}@example.test`,name:'隔离工程验证',password:`disabled-${namespace}`,role:'admin'}});users.push(owner.id);
 const reader=await prisma.user.create({data:{email:`distributed-reader-${namespace}@example.test`,name:'隔离读取验证',password:`disabled-${namespace}`}});users.push(reader.id);
 const kb=await prisma.knowledgeBase.create({data:{userId:owner.id,name:'虚构链路检查',published:false}});
 const a=await document(owner.id,kb.id,'共享报销.md','# 报销流程\nREF-2026-07 的报销申请应在出差后 17 天内提交。附件上限为 8 MB。',{expiredLease:true});
 const secret=await document(owner.id,kb.id,'私有细则.md','# 私有细则\nPRIVATE-CANARY 不允许其他账号读取。REF-2026-07 的内部报销期限为 999 天。',{private:true});
 const b=await document(owner.id,kb.id,'另一套餐.md','# 企业附件\n企业版附件上限为 64 MB，支持多人审批。');
 await Promise.all([a,secret,b].map((d)=>wait(d.generationId)));
 assert.equal(await prisma.ragStage.count({where:{generationId:a.generationId,status:'completed'}}),4);
 assert.ok((await prisma.ragStage.findUniqueOrThrow({where:{generationId_stage:{generationId:a.generationId,stage:'parse'}}})).attempts>=1);
 checks.push('real Kafka four-stage ingestion completes; an expired stage lease is recovered');
 const mapping=await elastic().indices.getMapping({index:esConfig.index});const properties=Object.values(mapping)[0].mappings.properties!;
 assert.equal((properties.embedding as {dims?:number}).dims,2048);assert.equal((properties.embedding as {index_options?:{type?:string}}).index_options?.type,'hnsw');
 const analyze=await elastic().indices.analyze({index:esConfig.index,analyzer:'rag_index',text:'知识库父子分块'});assert.ok(analyze.tokens?.some((t)=>t.token==='知识库'));
 checks.push('actual ES mapping uses 2048-dimensional HNSW and IK analysis');
 await prisma.knowledgeBase.update({where:{id:kb.id},data:{published:true}});
 for(const mode of ['keyword','vector','hybrid','hybrid_rescore','rerank'] as const){const result=await searchKnowledgeDetailed(reader.id,[a.id,b.id],'REF-2026-07 的报销期限',signal,{mode});assert.ok(result.chunks.some((c)=>c.documentId===a.id));assert.ok(result.chunks.every((c)=>c.documentId!==secret.id&&!c.text.includes('PRIVATE-CANARY')));if(mode==='rerank')assert.equal(result.diagnostics.rerank.status,'applied');}
 await assert.rejects(()=>searchKnowledgeDetailed(reader.id,[secret.id],'REF-2026-07',signal));
 checks.push('BM25, KNN, hybrid, Rescore and real model reranking execute with private-file prefiltering');
 await prisma.document.update({where:{id:a.id},data:{visibility:'private'}});
 await assert.rejects(()=>searchKnowledgeDetailed(reader.id,[a.id],'报销期限',signal));
 await prisma.document.update({where:{id:a.id},data:{visibility:'inherit'}});
 checks.push('database authorization revocation prevents retrieval even while ES metadata remains stale');
 const before=await prisma.chunk.count({where:{generationId:a.generationId}});const outbox=await prisma.ragOutbox.findFirstOrThrow({where:{generationId:a.generationId,topic:stageTopic('index')}});const event=eventSchema.parse(outbox.payload);
 const producer=kafka().producer();await producer.connect();try{await producer.send({topic:outbox.topic,messages:[{key:'duplicate-test',value:JSON.stringify(event)},{key:'duplicate-test',value:JSON.stringify(event)}]});}finally{await producer.disconnect();}
 assert.equal(await processPipelineEvent(event,signal),'ignored');await delay(1500);assert.equal(await prisma.chunk.count({where:{generationId:a.generationId}}),before);
 checks.push('duplicate Kafka deliveries and completed-stage replay do not duplicate chunks or replace citations');
 await prisma.knowledgeBase.update({where:{id:kb.id},data:{published:false}});
 const bad=await document(owner.id,kb.id,'格式错误.pdf','修复格式标识后可以读取这份 UTF-8 文本，报销时限 17 天。');await wait(bad.generationId,'failed');
 const letter=await prisma.ragDeadLetter.findFirstOrThrow({where:{generationId:bad.generationId,replayedAt:null}});const oldEvent=eventSchema.parse(letter.payload);
 await prisma.document.update({where:{id:bad.id},data:{name:'已修复的测试格式.md'}});
 await prisma.$transaction((tx)=>replayDeadLetter(tx,letter.id,owner.id));await wait(bad.generationId);
 assert.equal(await processPipelineEvent(oldEvent,signal),'ignored');assert.ok((await prisma.ragDeadLetter.findUniqueOrThrow({where:{id:letter.id}})).replayedAt);
 checks.push('invalid PDF enters durable DLQ; repaired synthetic format can replay the failed stage; old epoch is fenced');
 const oldChunk=await prisma.chunk.findFirstOrThrow({where:{generationId:a.generationId,kind:'leaf'}});
 const replacement=await document(owner.id,kb.id,'共享报销新版.md','# 报销流程\nREF-2026-07 的报销申请调整为 23 天内提交。', {replacesId:a.id});await wait(replacement.generationId);
 assert.equal((await prisma.document.findUniqueOrThrow({where:{id:a.id}})).isCurrent,false);assert.ok(await prisma.chunk.findUnique({where:{id:oldChunk.id}}));
 checks.push('replacement switches current version after ES refresh and retains historical source chunks');
 report.measurements={stages:4,dimensions:2048,documents:files.length,duplicateChunksAdded:0,realRerank:true};report.status='passed';
}
void main().catch((e)=>{report.status='failed';report.error=e instanceof Error?e.message:'Unknown failure';process.exitCode=1;}).finally(async()=>{
 try{
  await prisma.session.deleteMany({where:{userId:{in:users}}});
  await prisma.user.deleteMany({where:{id:{in:users},email:{contains:namespace}}});
  let deferred=false;
  if(generations.length)try{await elastic().deleteByQuery({index:esConfig.index,query:{terms:{generationId:generations}},conflicts:'proceed',refresh:true});}catch{await prisma.ragIndexCleanup.createMany({data:generations.map((generationId)=>({generationId,availableAt:new Date(Date.now()+300000)})),skipDuplicates:true});deferred=true;}
  for(const id of files)await removeFile(id);for(const id of generations)await removeArtifacts(id);
  report.cleanup=deferred?'database/files completed; index cleanup queued':'completed';
 }catch{report.cleanup='failed';process.exitCode=1;}
 await writeFile('reports/rag-distributed-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await prisma.$disconnect();
});
