import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildSearchRequests } from '../lib/rag/search/retrieval';
import { encodeSearchVector, decodeSearchVector } from '../lib/rag/search/embedding';
import { eventSchema, nextEvent, stageTopic } from '../lib/rag/messaging/contracts';
import { classifyStageError } from '../lib/rag/pipeline/engine';
import { ProviderError } from '../lib/rag/provider';
import { writeArtifact, readArtifact, removeArtifacts, sectionsSchema } from '../lib/rag/pipeline/artifacts';
import {indexSearchBatch} from '../lib/rag/search/bulk';

test('ES keyword and ANN requests share a pre-filtered generation scope; Rescore stays on the keyword branch',()=>{
 const scope=[randomUUID(),randomUUID()];const requests=buildSearchRequests('退课申请 SEC-2026-07',scope,Array(2048).fill(.01));
 assert.deepEqual(requests.keyword.query?.bool?.filter,[{terms:{generationId:scope}}]);
 assert.deepEqual(requests.knn.knn&&'filter' in requests.knn.knn?requests.knn.knn.filter:undefined,[{terms:{generationId:scope}}]);
 assert.ok(requests.keyword.rescore);assert.equal(requests.knn.rescore,undefined);assert.equal(requests.knn.post_filter,undefined);
 assert.equal(requests.knn._source,false);assert.equal(buildSearchRequests('query',scope,undefined,false).keyword.rescore,undefined);
});
test('2048-dimensional cache is float32 binary and rejects legacy/wrong/non-finite vectors',()=>{
 const v=Array.from({length:2048},(_,i)=>Math.sin(i)/100);const bytes=encodeSearchVector(v);assert.equal(bytes.length,8192);assert.deepEqual(decodeSearchVector(bytes),Array.from(Float32Array.from(v)));
 assert.throws(()=>encodeSearchVector(Array(1024).fill(1)));assert.throws(()=>decodeSearchVector(Buffer.alloc(4096)));assert.throws(()=>encodeSearchVector(Array(2048).fill(NaN)));
});
test('pipeline contracts retain document version and trace while each delivery gets a new id',()=>{
 const first=nextEvent({generationId:randomUUID(),documentId:randomUUID(),epoch:1,stage:'parse',profile:'test',traceId:randomUUID()},'parse');
 const second=nextEvent(first,'chunk');assert.notEqual(second.eventId,first.eventId);assert.equal(second.generationId,first.generationId);assert.equal(second.traceId,first.traceId);assert.equal(second.epoch,1);assert.ok(eventSchema.safeParse(second).success);
 assert.ok(!eventSchema.safeParse({...second,stage:'delete-anything'}).success);assert.ok(!eventSchema.safeParse({...second,arbitraryPath:'C:/'}).success);assert.match(stageTopic('embed'),/\.embed\.requested$/);
});
test('stage retry distinguishes transient pressure from invalid credentials and malformed documents',()=>{
 assert.ok(classifyStageError(new ProviderError(429)).transient);assert.ok(classifyStageError(new ProviderError(503)).transient);assert.ok(!classifyStageError(new ProviderError(401)).transient);assert.ok(!classifyStageError(new Error('invalid PDF')).transient);
 assert.ok(classifyStageError({statusCode:503}).transient);assert.ok(!classifyStageError({statusCode:400}).transient);
 assert.ok(classifyStageError({code:'P2028'}).transient);assert.ok(classifyStageError({code:'P2034'}).transient);assert.ok(!classifyStageError({code:'P2002'}).transient);
});
test('stale worker artifacts cannot overwrite the winning lease output',async()=>{
 const gen=randomUUID(),old=randomUUID(),winner=randomUUID();
 try{
  const current=[{text:'current output',page:1,heading:null}];await writeArtifact(gen,'parse',current,winner);
  await writeArtifact(gen,'parse',[{text:'late old output',page:1,heading:null}],old);
  assert.deepEqual(await readArtifact(gen,'parse',sectionsSchema,winner),current);
  await assert.rejects(()=>readArtifact('../outside','parse',sectionsSchema,winner));
 }finally{await removeArtifacts(gen);}
});

test('ES bulk retries only transient failed items while preserving stable IDs',async()=>{
 const seen:string[][]=[];const responses=[[201,429,503],[201,503],[201]];
 await indexSearchBatch(['a','b','c'].map((id)=>({id,document:{text:id}})),AbortSignal.timeout(5000),async(items)=>{seen.push(items.map((i)=>i.id));return responses.shift()!;});
 assert.deepEqual(seen,[['a','b','c'],['b','c'],['c']]);
});

test('ES bulk rejects permanent mapping failures and never sends after cancellation',async()=>{
 const item=[{id:'a',document:{text:'value'}}];let requests=0;
 await assert.rejects(()=>indexSearchBatch(item,AbortSignal.timeout(5000),async()=>{requests++;return[400];}));assert.equal(requests,1);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>indexSearchBatch(item,controller.signal,async()=>{requests++;return[201];}));assert.equal(requests,1);
});
