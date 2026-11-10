import 'dotenv/config';
import { ensureSearchIndex, elastic } from '../lib/rag/search/client';
import { ensureTopics, kafka } from '../lib/rag/messaging/client';
async function main(){
 for(const [stage,operation] of [['elasticsearch',async()=>{const info=await elastic().info();await ensureSearchIndex();return{version:info.version.number};}],['kafka',async()=>{await ensureTopics();const admin=kafka().admin({retry:{retries:0}});await admin.connect();try{return{topics:(await admin.listTopics()).filter((t)=>t.startsWith('sky-chat'))};}finally{await admin.disconnect();}}]] as const){
  try{console.log(JSON.stringify({stage,status:'ready',detail:await operation()}));}catch(error){const e=error as {name?:string;message?:string;meta?:{statusCode?:number;body?:{error?:{type?:string;reason?:string}}}};console.log(JSON.stringify({stage,status:'failed',name:e.name,statusCode:e.meta?.statusCode,type:e.meta?.body?.error?.type,reason:e.meta?.body?.error?.reason||e.message?.replace(/(password|token|authorization|api[_-]?key)[^ ,;]*/gi,'[redacted]')}));process.exitCode=1;}
 }
}
void main();
