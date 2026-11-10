import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RagError, ragErrorResponse } from '@/lib/rag/access';
import { replayDeadLetter } from '@/lib/rag/pipeline/engine';
import { esEnabled, kafkaEnabled, esConfig } from '@/lib/rag/search/config';
import { elastic } from '@/lib/rag/search/client';
import { kafka, consumerGroup } from '@/lib/rag/messaging/client';
import { stages, stageTopic } from '@/lib/rag/messaging/contracts';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:'Unauthorized'},{status:401});
  if (user.role!=='admin') return Response.json({error:'仅管理员可查看处理记录'},{status:403});
  try {
    const url=new URL(request.url);const documentId=url.searchParams.get('documentId');if(documentId)z.string().uuid().parse(documentId);
    const owner={document:{userId:user.userId,...(documentId?{id:documentId}:{})}};
    const [generations,pendingEvents,failedEvents]=await Promise.all([
      prisma.ragGeneration.findMany({where:owner,orderBy:{createdAt:'desc'},take:30,select:{id:true,status:true,stage:true,progress:true,error:true,createdAt:true,metrics:true,epoch:true,document:{select:{id:true,name:true,activeGenerationId:true,pendingGenerationId:true,knowledgeBase:{select:{published:true}}}},stages:{select:{stage:true,status:true,attempts:true,errorCode:true,lastError:true,durationMs:true}},deadLetters:{where:{replayedAt:null},select:{id:true,stage:true,message:true,attempts:true}}}}),
      prisma.ragOutbox.count({where:{generation:owner,status:{in:['queued','leased']}}}),
      prisma.ragDeadLetter.count({where:{generation:owner,replayedAt:null}}),
    ]);
    let health:object|undefined;
    if(url.searchParams.get('health')==='1'){
      const search=await elastic().cluster.health({index:esConfig.index,wait_for_status:'yellow',timeout:'1s'}, {requestTimeout:3000}).then((h)=>!h.timed_out&&h.status!=='red').catch(()=>false);
      const admin=kafka().admin({retry:{retries:0}});let broker=false;const lag:Record<string,number>={};
      try{await admin.connect();for(const stage of stages){const topic=stageTopic(stage);const end=await admin.fetchTopicOffsets(topic);const committed=await admin.fetchOffsets({groupId:consumerGroup(stage),topics:[topic]});lag[stage]=end.reduce((total,p)=>{const saved=committed[0]?.partitions.find((c)=>c.partition===p.partition)?.offset||'0';return total+Math.max(0,Number(BigInt(p.offset)-BigInt(saved==='-1'?'0':saved)));},0);}broker=true;}catch{}finally{await admin.disconnect().catch(()=>{});}
      health={elasticsearch:search,kafka:broker,index:esConfig.index,lag};
    }
    return Response.json({searchBackend:esEnabled()?'elasticsearch':'postgres',ingestionBackend:kafkaEnabled()?'kafka':'database',generations,pendingEvents,failedEvents,health});
  }catch(error){return ragErrorResponse(error);}
}
export async function POST(request:Request){
  const user=await getCurrentUser();if(!user)return Response.json({error:'Unauthorized'},{status:401});if(user.role!=='admin')return Response.json({error:'仅管理员可重试处理'},{status:403});
  try{const {id}=z.object({id:z.string().uuid()}).parse(await request.json());await prisma.$transaction((tx)=>replayDeadLetter(tx,id,user.userId));return Response.json({success:true});}
  catch(error){if(error instanceof Error&&/^(失败记录|请先取消|该版本)/.test(error.message))return ragErrorResponse(new RagError(error.message,409));return ragErrorResponse(error);}
}
