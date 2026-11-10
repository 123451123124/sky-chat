import {setTimeout as delay} from 'node:timers/promises';
import {elastic} from './client';
import {esConfig} from './config';
import {ProviderError} from '../provider';
export type IndexItem={id:string;document:Record<string,unknown>};
type Send=(items:IndexItem[],signal:AbortSignal)=>Promise<number[]>;
const sendBulk:Send=async(items,signal)=>{
 const response=await elastic().bulk({index:esConfig.index,operations:items.flatMap((item)=>[{index:{_id:item.id}},item.document])},{signal});
 return response.items.map((item)=>item.index?.status||500);
};
// A successful HTTP response can still contain individual failed bulk items.
export async function indexSearchBatch(items:IndexItem[],signal:AbortSignal,send:Send=sendBulk){
 let pending=items;
 for(let attempt=0;pending.length&&attempt<3;attempt++){
  signal.throwIfAborted();
  const statuses=await send(pending,signal);
  if(statuses.length!==pending.length)throw new ProviderError(502);
  const retry:IndexItem[]=[];
  statuses.forEach((status,i)=>{if(status>=400){if(status===429||status>=500)retry.push(pending[i]);else throw new Error('ES 索引字段或向量格式不正确');}});
  pending=retry;
  if(pending.length&&attempt<2)await delay(100*2**attempt,undefined,{signal});
 }
 if(pending.length)throw new ProviderError(503);
}
