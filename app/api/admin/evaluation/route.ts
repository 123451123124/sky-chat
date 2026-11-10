import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth';
import { esEnabled } from '@/lib/rag/search/config';
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error:'Unauthorized' }, { status:401 });
  if (user.role !== 'admin') return Response.json({ error:'仅管理员可以查看评测报告' }, { status:403 });
  try { const data = JSON.parse(await readFile(path.join(process.cwd(),'reports',esEnabled()?'rag-es-evaluation.json':'rag-evaluation.json'),'utf8')); return Response.json(data, { headers:{'Cache-Control':'no-store'} }); }
  catch { return Response.json({ error:'尚无可用报告，请先完成固定样本评测。' }, { status:404 }); }
}
