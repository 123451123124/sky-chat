import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { embedTexts, embedCachedTexts, newEmbeddingStats, clearEmbeddingMemoryCache,requestEmbeddingBatch } from '../lib/rag/embedding';
import {esEnabled} from '../lib/rag/search/config';
import {embedSearchTexts,clearSearchMemory} from '../lib/rag/search/embedding';
import { percentile } from '../lib/rag/evaluation';

async function main() {
  const namespace=randomUUID();const signal=AbortSignal.timeout(120000);const texts=Array.from({length:40},(_,i)=>`虚构基准条目 ${i}：批量上传资料后，后台解析并建立检索索引。此文本仅用于并发与缓存测试。`);
  const user=await prisma.user.create({data:{email:`benchmark-${namespace}@example.test`,name:'向量化基准',password:`disabled-${namespace}`}});
  const distributed=esEnabled();
  const raw=distributed?async(items:string[],s:AbortSignal)=>(await Promise.all(Array.from({length:Math.ceil(items.length/10)},(_,i)=>requestEmbeddingBatch(items.slice(i*10,i*10+10),s,undefined,2048)))).flat():embedTexts;
  const cached=distributed?embedSearchTexts:embedCachedTexts;const clear=distributed?clearSearchMemory:clearEmbeddingMemoryCache;
  try {
    await raw(texts.slice(0,30),signal);
    const times:{serial:number[];parallel:number[]}={serial:[],parallel:[]};
    for(let round=0;round<3;round++)for(const mode of (round%2?['parallel','serial']:['serial','parallel']) as Array<'serial'|'parallel'>){
      const start=Date.now();
      if(mode==='serial')for(let i=0;i<texts.length;i+=10)await raw(texts.slice(i,i+10),signal);
      else await raw(texts,signal);
      times[mode].push(Date.now()-start);
    }
    const cold=newEmbeddingStats();const warm=newEmbeddingStats();const memory=newEmbeddingStats();const coldStart=Date.now();await cached(user.id,[...texts,...texts.slice(0,10)],signal,cold);const coldMs=Date.now()-coldStart;clear(user.id);const warmStart=Date.now();await cached(user.id,texts,signal,warm);const warmMs=Date.now()-warmStart;const memoryStart=Date.now();await cached(user.id,texts,signal,memory);const memoryMs=Date.now()-memoryStart;
    if(cold.requests!==4||warm.requests!==0)throw new Error('Unexpected cache benchmark request count');
    const report={date:new Date().toISOString(),dimensions:distributed?2048:1024,texts:40,batchSize:10,concurrency:3,rounds:3,measurements:times,medianMs:{serial:percentile(times.serial,.5),parallel:percentile(times.parallel,.5)},cache:{coldMs,warmMs,memoryMs,databaseHits:warm.databaseHits,memoryHits:memory.memoryHits,coldRequests:cold.requests,warmRequests:warm.requests,duplicateInputs:10,uniqueTexts:cold.unique},caveat:'真实阿里云接口、小批量虚构文本、单机进程内测试。轮换串行/并行顺序并报告全部轮次；结果受网络和供应商负载影响，不代表稳定吞吐或生产 SLA。'};
    await writeFile(distributed?'reports/embedding-es-benchmark.json':'reports/embedding-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await prisma.user.deleteMany({where:{id:user.id,email:{contains:namespace}}});await prisma.$disconnect();}
}
void main().catch((e)=>{console.error(e instanceof Error?e.message:'Benchmark failed');process.exitCode=1;});
