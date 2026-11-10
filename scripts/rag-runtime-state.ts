import 'dotenv/config';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {prisma} from '../lib/prisma';
import {elastic} from '../lib/rag/search/client';
import {esConfig} from '../lib/rag/search/config';
import {kafka,consumerGroup} from '../lib/rag/messaging/client';
import {stages,stageTopic} from '../lib/rag/messaging/contracts';
async function main(){
 const documents=await prisma.document.findMany({select:{status:true,activeGenerationId:true,isCurrent:true}});
 const ids=documents.filter((d)=>d.isCurrent&&d.status==='ready'&&d.activeGenerationId).map((d)=>d.activeGenerationId!);
 const [health,settings,indexed,leaves,pendingEvents,temporaryActors]=await Promise.all([
  elastic().cluster.health({index:esConfig.index}),elastic().cluster.getSettings({flat_settings:true}),elastic().count({index:esConfig.index}),
  prisma.chunk.count({where:{generationId:{in:ids},kind:'leaf'}}),prisma.ragOutbox.count({where:{status:{not:'sent'}}}),
  prisma.user.count({where:{email:{endsWith:'@example.test'},OR:['eval-','engine-','distributed-','rag-test-','pipeline-ui-','benchmark-'].map((prefix)=>({email:{startsWith:prefix}}))}}),
 ]);
 const admin=kafka().admin();const lag:Record<string,number>={};
 try{await admin.connect();for(const stage of stages){const topic=stageTopic(stage);const end=await admin.fetchTopicOffsets(topic);const offsets=await admin.fetchOffsets({groupId:consumerGroup(stage),topics:[topic]});lag[stage]=end.reduce((sum,p)=>{const saved=offsets[0]?.partitions.find((c)=>c.partition===p.partition)?.offset||'0';return sum+Math.max(0,Number(BigInt(p.offset)-BigInt(saved==='-1'?'0':saved)));},0);}}finally{await admin.disconnect();}
 const login=await fetch('http://127.0.0.1:3100/login');
 assert.equal(login.status,200);assert.notEqual(health.status,'red');assert.equal(temporaryActors,0);assert.equal(indexed.count,leaves);assert.equal(pendingEvents,0);
 const keys=['low','high','flood_stage'];
 const report={date:new Date().toISOString(),status:'passed',webStatus:login.status,searchBackend:process.env.RAG_SEARCH_BACKEND,ingestionBackend:process.env.RAG_INGESTION_BACKEND,elasticsearchStatus:health.status,approvedLocalWatermarks:Object.fromEntries(keys.map((key)=>[key,settings.persistent[`cluster.routing.allocation.disk.watermark.${key}`]])),documents:documents.length,currentReadyGenerations:ids.length,activeLeaves:leaves,indexedLeaves:indexed.count,pendingEvents,consumerLag:lag,temporaryActors};
 await writeFile('reports/rag-runtime-state.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
void main().catch((e)=>{console.error('Runtime verification failed',JSON.stringify({name:e?.name,code:e?.code}));process.exitCode=1;}).finally(()=>prisma.$disconnect());
