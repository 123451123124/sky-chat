import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ragErrorResponse } from '@/lib/rag/access';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const run = await prisma.agentRun.findFirst({ where: { id: (await params).id, userId: user.userId }, select: { trace: true, status: true } });
    if (!run) return Response.json({ error: '执行记录不存在' }, { status: 404 });
    return Response.json(run);
  } catch (e) { return ragErrorResponse(e); }
}
