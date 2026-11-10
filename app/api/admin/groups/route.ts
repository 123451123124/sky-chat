import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RagError, ragErrorResponse } from '@/lib/rag/access';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可管理用户组' }, { status: 403 });
  const [groups, users] = await Promise.all([
    prisma.accessGroup.findMany({ orderBy: { name: 'asc' }, include: { members: { select: { userId: true } } } }),
    prisma.user.findMany({ select: { id: true, email: true, name: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ]);
  return Response.json({ groups, users });
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可管理用户组' }, { status: 403 });
  try {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(60), parentId: z.string().nullable() }),
      z.object({ action: z.enum(['addMember', 'removeMember']), userId: z.string(), groupId: z.string() }),
    ]).parse(await request.json());
    if (body.action === 'create') {
      const group = await prisma.$transaction(async (tx) => {
        if (body.parentId && !await tx.accessGroup.findUnique({ where: { id: body.parentId } })) throw new RagError('父用户组不存在');
        const ancestors = body.parentId ? await tx.groupClosure.findMany({ where: { descendantId: body.parentId } }) : [];
        if (ancestors.length >= 10) throw new RagError('用户组层级不能超过 10 层');
        const created = await tx.accessGroup.create({ data: { name: body.name, parentId: body.parentId } });
        await tx.groupClosure.createMany({ data: [{ ancestorId: created.id, descendantId: created.id }, ...ancestors.map((a) => ({ ancestorId: a.ancestorId, descendantId: created.id }))] });
        return created;
      });
      return Response.json(group, { status: 201 });
    }
    if (!await prisma.accessGroup.findUnique({ where: { id: body.groupId } }) || !await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } })) throw new RagError('用户或用户组不存在');
    if (body.action === 'addMember') await prisma.groupMembership.upsert({ where: { userId_groupId: { userId: body.userId, groupId: body.groupId } }, create: { userId: body.userId, groupId: body.groupId }, update: {} });
    else await prisma.groupMembership.deleteMany({ where: { userId: body.userId, groupId: body.groupId } });
    return Response.json({ success: true });
  } catch (e) { return ragErrorResponse(e); }
}
