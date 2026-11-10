import 'dotenv/config';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {prisma} from '../lib/prisma';
import {loadFile} from '../lib/rag/storage';
import {generationProfile,esConfig} from '../lib/rag/search/config';
import {elastic} from '../lib/rag/search/client';
async function main(){
 const docs=await prisma.document.findMany({where:{createdAt:{lt:new Date('2026-10-20T06:00:00Z')},isCurrent:true},include:{knowledgeBase:true}});
 const results=[];
 for(const doc of docs){
  assert.equal(doc.status,'ready');assert.ok(doc.activeGenerationId);
  const gen=await prisma.ragGeneration.findUniqueOrThrow({where:{id:doc.activeGenerationId}});
  assert.equal(gen.status,'ready');assert.equal(gen.profile,generationProfile(doc.knowledgeBase?.chunkingStrategy));
  assert.equal(createHash('sha256').update(await loadFile(doc.id)).digest('hex'),doc.hash);
  const legacy=await prisma.chunk.count({where:{documentId:doc.id,generationId:null}});
  const current=await prisma.chunk.count({where:{generationId:gen.id,kind:'leaf'}});
  const indexed=await elastic().count({index:esConfig.index,query:{term:{generationId:gen.id}}});
  assert.ok(legacy>0);assert.ok(current>0);assert.equal(indexed.count,current);
  results.push({documentId:doc.id,generationId:gen.id,rawHashVerified:true,legacyChunks:legacy,activeLeaves:current,indexedLeaves:indexed.count});
 }
 assert.ok(results.length>0);
 const report={date:new Date().toISOString(),status:'passed',documents:results,originalSourcesPreserved:true};
 await writeFile('reports/rag-es-cutover.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
void main().catch((e)=>{console.error('Cutover verification failed',JSON.stringify({name:e?.name,code:e?.code}));process.exitCode=1;}).finally(()=>prisma.$disconnect());
