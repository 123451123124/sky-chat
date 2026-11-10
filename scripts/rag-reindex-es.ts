import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { enqueueGeneration } from '../lib/rag/messaging/enqueue';
import { generationProfile } from '../lib/rag/search/config';
async function main(){
 const docs=await prisma.document.findMany({where:{isCurrent:true,status:'ready',user:{role:'admin'}},include:{knowledgeBase:true}});
 let queued=0;
 for(const doc of docs){
  const active=doc.activeGenerationId?await prisma.ragGeneration.findUnique({where:{id:doc.activeGenerationId}}):null;
  if(active?.status==='ready'&&active.profile===generationProfile(doc.knowledgeBase?.chunkingStrategy))continue;
  const pending=doc.pendingGenerationId?await prisma.ragGeneration.findUnique({where:{id:doc.pendingGenerationId}}):null;
  if(pending&&['queued','processing'].includes(pending.status))continue;
  await prisma.$transaction(async(tx)=>{
   if(doc.knowledgeBaseId)await tx.$queryRaw`SELECT id FROM "KnowledgeBase" WHERE id=${doc.knowledgeBaseId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${doc.id} FOR UPDATE`;
   await enqueueGeneration(tx,doc.id);
  });queued++;
 }
 console.log(JSON.stringify({examined:docs.length,queued,preservedOriginals:true}));
}
void main().catch(()=>{console.error('Reindex enqueue failed; original sources remain unchanged');process.exitCode=1;}).finally(()=>prisma.$disconnect());
