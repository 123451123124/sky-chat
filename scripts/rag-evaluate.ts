import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../lib/prisma';
import { corpus, queries } from '../tests/fixtures/retrieval-corpus';
import { esEnabled } from '../lib/rag/search/config';
import { enqueueGeneration } from '../lib/rag/messaging/enqueue';
import { embedSearchTexts } from '../lib/rag/search/embedding';
import { heldoutQueries } from '../tests/fixtures/retrieval-heldout';
import { elastic } from '../lib/rag/search/client';
import { esConfig } from '../lib/rag/search/config';
import { removeArtifacts } from '../lib/rag/pipeline/artifacts';
import type { SearchMode } from '../lib/rag/search/retrieval';
import { processNextDocument } from '../lib/rag/ingestion';
import { storeFile, removeFile } from '../lib/rag/storage';
import { embedCachedTexts } from '../lib/rag/embedding';
import { searchKnowledgeDetailed } from '../lib/rag/retrieval';
import { percentile, retrievalMetrics } from '../lib/rag/evaluation';

async function main() {
  const namespace = randomUUID(); const files: string[] = []; let userId: string | undefined;
  const distributed=esEnabled();const samples=distributed?[...queries,...heldoutQueries]:queries;const generationIds:string[]=[];
  const signal = AbortSignal.timeout(3600000);
  try {
    const user = await prisma.user.create({ data: { email:`eval-${namespace}@example.test`,name:'固定样本检索评测',password:`disabled-${namespace}`,role:'admin' } }); userId = user.id;
    const kb = await prisma.knowledgeBase.create({ data:{ userId:user.id,name:'虚构政策检索评测',visibility:'private' } });
    const keys = new Map<string,string>();
    for (const item of corpus) {
      const id = randomUUID(); await storeFile(id,Buffer.from(item.text)); files.push(id); keys.set(id,item.key);
      await prisma.$transaction(async(tx)=>{await tx.document.create({data:{id,userId:user.id,knowledgeBaseId:kb.id,name:item.name,size:Buffer.byteLength(item.text),mediaType:'text/plain',hash:randomUUID(),...(!distributed?{job:{create:{}}}:{})}});if(distributed)generationIds.push((await enqueueGeneration(tx,id)).id);});
    }
    while (true) {
      signal.throwIfAborted();
      const docs = await prisma.document.findMany({where:{id:{in:files}},select:{status:true}});
      if (docs.some((d) => d.status === 'failed')) throw new Error('评测资料处理失败');
      if (docs.every((d) => d.status === 'ready')) break;
      if(!distributed)await Promise.all([processNextDocument(signal),processNextDocument(signal)]); await delay(distributed?750:150);
    }
    const modes:SearchMode[] = distributed?['keyword','vector','hybrid','hybrid_rescore','rerank']:['vector','hybrid','rerank'];
    const cases: Array<{sampleIndex:number;split:string;query:string;relevant:string[];mode:string;retrieved:string[];metrics:ReturnType<typeof retrievalMetrics>;durationMs:number;rerankStatus:string}> = [];
    const queryConcurrency=Math.min(2,Math.max(1,Number(process.env.EVAL_QUERY_CONCURRENCY)||1));
    let cursor=0,completed=0;
    let progressWrites=Promise.resolve();
    const evaluations=await Promise.allSettled(Array.from({length:queryConcurrency},async()=>{while(cursor<samples.length){
      signal.throwIfAborted();const i=cursor++;
      const sample = samples[i]; await (distributed?embedSearchTexts:embedCachedTexts)(user.id,[sample.query],signal);
      // Rotate mode order. All modes share warm query embeddings, corpus and labels.
      for (const mode of [...modes.slice(i%modes.length),...modes.slice(0,i%modes.length)]) {
        const result = await searchKnowledgeDetailed(user.id,files,sample.query,signal,{mode,topK:5});
        if (mode === 'rerank' && result.diagnostics.rerank.status !== 'applied') throw new Error('重排服务没有实际执行，不能生成完整对比报告');
        const retrieved = result.chunks.map((c) => keys.get(c.documentId)!);
        cases.push({sampleIndex:i,split:i<queries.length?'baseline':'frozenAdditional',query:sample.query,relevant:sample.relevant,mode,retrieved,metrics:retrievalMetrics(retrieved,sample.relevant),durationMs:result.diagnostics.timings.totalMs,rerankStatus:result.diagnostics.rerank.status});
      }
      completed++;
      if (completed%7===0) {
        const snapshot=JSON.stringify({status:'running',backend:distributed?'elasticsearch':'postgres',queryConcurrency,completedQuestions:completed,queryCount:samples.length,cases},null,2);
        progressWrites=progressWrites.then(()=>writeFile('reports/rag-evaluation-progress.json',snapshot));await progressWrites;
        console.log(`Evaluated ${completed}/${samples.length} questions`);
      }
    }}));
    await progressWrites;
    const failure=evaluations.find((r)=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    cases.sort((a,b)=>a.sampleIndex-b.sampleIndex||modes.indexOf(a.mode as SearchMode)-modes.indexOf(b.mode as SearchMode));
    const results = Object.fromEntries(modes.map((mode) => {
      const rows = cases.filter((c) => c.mode === mode); const average = (key:'recallAt5'|'mrr'|'ndcgAt5') => rows.reduce((sum,r) => sum+r.metrics[key],0)/rows.length;
      return [mode,{recallAt5:average('recallAt5'),mrr:average('mrr'),ndcgAt5:average('ndcgAt5'),p50Ms:percentile(rows.map((r) => r.durationMs),.5),p95Ms:percentile(rows.map((r) => r.durationMs),.95),rerankApplied:rows.filter((r) => r.rerankStatus==='applied').length}];
    }));
    const splitResults=Object.fromEntries(['baseline','frozenAdditional'].map((split)=>[split,Object.fromEntries(modes.map((mode)=>{const rows=cases.filter((c)=>c.split===split&&c.mode===mode);return[mode,{count:rows.length,recallAt5:rows.reduce((s,r)=>s+r.metrics.recallAt5,0)/(rows.length||1),mrr:rows.reduce((s,r)=>s+r.metrics.mrr,0)/(rows.length||1),ndcgAt5:rows.reduce((s,r)=>s+r.metrics.ndcgAt5,0)/(rows.length||1)}];}))]));
    const report = { status:'completed', backend:distributed?'elasticsearch':'postgres', queryConcurrency, dimensions:distributed?2048:1024, tuningCount:queries.length, frozenAdditionalCount:distributed?heldoutQueries.length:0, date:new Date().toISOString(),dataset:distributed?'虚构政策集 v2：8 文档、100 问题（42 基线 + 58 冻结补充），含编号、条件否定与跨文档比较':'虚构政策集 v1：8 文档、42 问题',queryCount:samples.length,results,splitResults,cases,caveat:distributed?'文档级指标，仅反映虚构小样本；查询向量预热、策略顺序轮换，各策略采用相同父块回填和去重。queryConcurrency 记录并行问题数，耗时包含该并发负载及远程数据库鉴权。42 个既有问题及 58 个冻结补充分别记录，报告并非公开基准、答案准确率或稳定吞吐保证。':'文档级小样本；查询向量预热，向量基线子块与混合父块存在后处理差异。不是答案准确率。' };
    await mkdir('reports',{recursive:true}); await writeFile(distributed?'reports/rag-es-evaluation.json':'reports/rag-evaluation.json',JSON.stringify(report,null,2)); console.log(JSON.stringify({queryCount:samples.length,results}));
    await writeFile('reports/rag-evaluation-progress.json',JSON.stringify({status:'completed',backend:report.backend,completedQuestions:completed,queryCount:samples.length}));
  } finally {
    if (userId) await prisma.user.deleteMany({where:{id:userId,email:{contains:namespace}}});
    if(generationIds.length)try{await elastic().deleteByQuery({index:esConfig.index,query:{terms:{generationId:generationIds}},conflicts:'proceed',refresh:true});}catch{await prisma.ragIndexCleanup.createMany({data:generationIds.map((generationId)=>({generationId,availableAt:new Date(Date.now()+300000)})),skipDuplicates:true});}
    for (const id of files) await removeFile(id);
    for (const id of generationIds) await removeArtifacts(id);
    console.log('Evaluation cleanup completed');
    await prisma.$disconnect();
  }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : 'Evaluation failed'); process.exitCode=1; });
