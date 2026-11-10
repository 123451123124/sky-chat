import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSession, authorizedDocuments, documentIdsSchema, ragErrorResponse } from '@/lib/rag/access';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const { documentIds } = z.object({ documentIds: documentIdsSchema }).parse(await request.json());
    await assertSession(user.userId, id);
    await authorizedDocuments(user.userId, documentIds);
    await prisma.$transaction(async (tx) => {
      await tx.sessionDocument.deleteMany({ where: { sessionId: id } });
      if (documentIds.length) await tx.sessionDocument.createMany({ data: documentIds.map((documentId) => ({ sessionId: id, documentId })) });
    });
    return Response.json({ selectedIds: documentIds });
  } catch (e) { return ragErrorResponse(e); }
}
