import 'dotenv/config';
import { prisma } from '../lib/prisma';
async function main() {
  const [documents, generations, outbox, deadLetters] = await Promise.all([
    prisma.document.groupBy({by:['status'],_count:true}),
    prisma.ragGeneration.groupBy({by:['status','stage'],_count:true}),
    prisma.ragOutbox.groupBy({by:['status'],_count:true}),
    prisma.ragDeadLetter.count({where:{replayedAt:null}}),
  ]);
  console.log(JSON.stringify({documents,generations,outbox,deadLetters}));
}
void main().catch((e)=>{console.error('Unable to read RAG status',JSON.stringify({code:e?.code,name:e?.name}));process.exitCode=1;}).finally(()=>prisma.$disconnect());
