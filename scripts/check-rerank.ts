import 'dotenv/config';
import { rerank } from '../lib/rag/reranking';
async function main() {
  const result = await rerank('日志保留多少天？', [{ id:'a',text:'日志默认保留 17 天。' }, { id:'b',text:'附件最大为 8 MB。' }], AbortSignal.timeout(20000));
  console.log(JSON.stringify({ info:result.info, order:result.items.map((d) => ({ id:d.id,score:d.rerankScore })) }));
  if (result.info.status !== 'applied') process.exitCode = 1;
}
void main();
