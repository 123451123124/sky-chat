import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { elastic } from '../lib/rag/search/client';
import { percentile } from '../lib/rag/evaluation';

const index=`sky-chat-capacity-${randomUUID()}`;const dimensions=2048;const count=10000;const client=elastic();
function vector(seed:number){let state=seed>>>0;const values=Array.from({length:dimensions},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296-.5;});const norm=Math.sqrt(values.reduce((s,n)=>s+n*n,0));return values.map((v)=>v/norm);}
async function main(){
 const health=await client.cluster.health({wait_for_status:'yellow',timeout:'10s'},{requestTimeout:15000});if(health.timed_out||health.status==='red')throw new Error('ES 主分片未就绪，未运行容量测试');
 let report:object|undefined;
 try{
  await client.indices.create({index,settings:{number_of_shards:1,number_of_replicas:0,refresh_interval:'-1'},mappings:{properties:{group:{type:'keyword'},embedding:{type:'dense_vector',dims:dimensions,index:true,similarity:'cosine',index_options:{type:'hnsw',m:16,ef_construction:100}}}}});
  const start=Date.now();
  for(let offset=0;offset<count;offset+=100){const operations=[];for(let i=offset;i<offset+100;i++)operations.push({index:{_id:String(i)}},{group:String(i%5),embedding:vector(i+1)});const result=await client.bulk({index,operations},{requestTimeout:60000});assert.equal(result.errors,false);if(offset%2000===0)console.log(`Indexed ${offset+100}/${count} synthetic vectors`);}
  await client.indices.refresh({index});const ingestionMs=Date.now()-start;
  const cases:Array<{query:number;numCandidates:number;filtered:boolean;recallAt10:number;annMs:number;exactMs:number}>=[];
  for(let i=0;i<30;i++){
   const query=vector(100000+i);const group=i%3===0?String(i%5):null;const filter=group?[{term:{group}}]:[];
   const t=Date.now();const exact=await client.search({index,size:10,_source:false,query:{script_score:{query:{bool:{filter}},script:{source:"cosineSimilarity(params.q, 'embedding') + 1.0",params:{q:query}}}}});const exactMs=Date.now()-t;
   const gold=new Set(exact.hits.hits.map((h)=>h._id));
   for(const numCandidates of [50,200,1000]){
    const a=Date.now();const ann=await client.search({index,size:10,_source:false,knn:{field:'embedding',query_vector:query,k:10,num_candidates:numCandidates,filter}});const annMs=Date.now()-a;
    const hits=ann.hits.hits.map((h)=>h._id!);if(group)assert.ok(hits.every((id)=>Number(id)%5===Number(group)));
    cases.push({query:i,numCandidates,filtered:group!==null,recallAt10:hits.filter((id)=>gold.has(id)).length/10,annMs,exactMs});
   }
  }
  const sweep=Object.fromEntries([50,200,1000].map((n)=>{const rows=cases.filter((c)=>c.numCandidates===n);return[n,{recallAt10:rows.reduce((s,c)=>s+c.recallAt10,0)/rows.length,p50Ms:percentile(rows.map((c)=>c.annMs),.5),p95Ms:percentile(rows.map((c)=>c.annMs),.95)}];}));
  const exactCases=cases.filter((c)=>c.numCandidates===200);
  report={date:new Date().toISOString(),dataset:'确定性合成随机向量；非业务文档，不调用 Embedding API',count,dimensions,queries:30,hnsw:{m:16,efConstruction:100,k:10},ingestionMs,ann:sweep[200],sweep,exact:{p50Ms:percentile(exactCases.map((c)=>c.exactMs),.5),p95Ms:percentile(exactCases.map((c)=>c.exactMs),.95)},filteredScopeViolations:0,cases,caveat:'单机、单分片、2048 维合成随机数据。查询顺序固定，存在预热影响。仅衡量此配置的索引与近似召回/耗时，不代表真实语义检索准确率、通用吞吐或生产 SLA。'};
 }finally{if(index.startsWith('sky-chat-capacity-'))await client.indices.delete({index,ignore_unavailable:true});}
 if(report){await writeFile('reports/rag-es-capacity.json',JSON.stringify({...report,cleanup:'completed'},null,2));console.log(JSON.stringify(report));}
}
void main().catch((e)=>{console.error(e instanceof Error?e.message.split('\n')[0]:'Capacity check failed');process.exitCode=1;});
