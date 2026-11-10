import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { tokenize } from '../lib/rag/tokenization';
import { textHash } from '../lib/rag/embedding';
async function main() {
  let count=0;
  while(true){
    const rows=await prisma.chunk.findMany({where:{kind:'leaf',searchText:''},take:100,select:{id:true,text:true,heading:true,document:{select:{name:true}}}});
    if(!rows.length)break;
    const values=rows.map((row)=>Prisma.sql`(${row.id},${tokenize(`${row.document.name} ${row.heading||''} ${row.text}`).join(' ') || '_'},${textHash(row.text)})`);
    await prisma.$executeRaw(Prisma.sql`UPDATE "Chunk" c SET "searchText"=v.tokens,"textHash"=v.hash FROM (VALUES ${Prisma.join(values)}) AS v(id,tokens,hash) WHERE c.id=v.id`);
    count+=rows.length;
  }
  console.log(JSON.stringify({indexedChunks:count,originalTextAndVectors:'preserved'}));
}
void main().catch((e)=>{console.error(e instanceof Error?e.message:'Index failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
