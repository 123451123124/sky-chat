import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RagError, ragErrorResponse, readableDocuments } from '@/lib/rag/access';
import { searchKnowledgeDetailed } from '@/lib/rag/retrieval';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可使用检索实验台' }, { status: 403 });
  try {
    const body = z.object({ knowledgeBaseId: z.string().min(1), query: z.string().trim().min(1).max(1000), mode: z.enum(['keyword','vector', 'hybrid', 'hybrid_rescore','rerank']), topK: z.number().int().min(1).max(12).default(6), tags: z.array(z.string().max(60)).max(10).default([]) }).parse(await request.json());
    const base = await prisma.knowledgeBase.findFirst({ where: { id: body.knowledgeBaseId, userId: user.userId } });
    if (!base) throw new RagError('知识库不存在', 404);
    const documents = await prisma.document.findMany({ where: { ...readableDocuments(user.userId), knowledgeBaseId: base.id, isCurrent: true, status: 'ready' }, select: { id: true } });
    if (!documents.length) throw new RagError('请先等待至少一个文件完成处理', 409);
    const result = await searchKnowledgeDetailed(user.userId, documents.map((d) => d.id), body.query, AbortSignal.any([request.signal, AbortSignal.timeout(45000)]), body);
    return Response.json(result);
  } catch (e) { return ragErrorResponse(e); }
}
