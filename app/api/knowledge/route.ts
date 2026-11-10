import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSession, RagError, ragErrorResponse, readableDocuments } from '@/lib/rag/access';
import { embeddingProfile } from '@/lib/rag/embedding';
import { pipelineProfile } from '@/lib/rag/splitting';
import { esEnabled, generationProfile } from '@/lib/rag/search/config';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const manage = url.searchParams.get('manage') === '1';
    if (manage && user.role !== 'admin') throw new RagError('仅管理员可以管理知识库', 403);
    if (sessionId) await assertSession(user.userId, sessionId);
    const [documents, knowledgeBases, selected, pendingVersions] = await Promise.all([
      prisma.document.findMany({ where: { ...(manage ? { userId: user.userId } : readableDocuments(user.userId)), isCurrent: true }, orderBy: { createdAt: 'desc' }, select: { id: true, familyId: true, name: true, size: true, status: true, error: true, chunkCount: true, knowledgeBaseId: true, createdAt: true, embeddingModel: true, revision: true, visibility: true, tags: true, progress: true, pipelineProfile: true, ingestionMetrics: true, activeGenerationId: true, ...(manage ? { generations: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, stage: true, status: true, progress: true, error: true } } } : {}), ...(manage ? { groupGrants: { select: { groupId: true } }, userGrants: { select: { userId: true } }, job: { select: { status: true, attempts: true, errorCode: true } } } : {}) } }),
      prisma.knowledgeBase.findMany({ where: manage ? { userId: user.userId } : { OR: [{ userId: user.userId }, { documents: { some: { ...readableDocuments(user.userId), isCurrent: true } } }] }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, published: true, visibility: true, chunkingStrategy: true, ...(manage ? { groupGrants: { select: { groupId: true } } } : {}) } }),
      sessionId ? prisma.sessionDocument.findMany({ where: { sessionId, document: readableDocuments(user.userId) }, select: { documentId: true } }) : [],
      manage ? prisma.document.findMany({ where: { userId: user.userId, isCurrent: false, status: { not: 'ready' } }, orderBy: { revision: 'desc' }, select: { id: true, familyId: true, revision: true, status: true } }) : [],
    ]);
    const readyGenerations = esEnabled() ? await prisma.ragGeneration.findMany({ where: { id: { in: documents.flatMap((d) => d.activeGenerationId ? [d.activeGenerationId] : []) }, status: 'ready' }, select: { id: true, profile: true } }) : [];
    return Response.json({ documents: documents.map(({ embeddingModel, familyId, activeGenerationId, generations, ...d }) => ({ ...d, ...(manage ? { pendingVersion: pendingVersions.find((v) => v.familyId === familyId), pipeline: generations?.[0] || null } : {}), needsReindex: d.status === 'ready' && (esEnabled() ? !readyGenerations.some((g) => g.id === activeGenerationId && g.profile === generationProfile(knowledgeBases.find((b) => b.id === d.knowledgeBaseId)?.chunkingStrategy)) : (embeddingModel !== embeddingProfile || (!!d.pipelineProfile && d.pipelineProfile !== pipelineProfile(knowledgeBases.find((b) => b.id === d.knowledgeBaseId)?.chunkingStrategy)))) })), knowledgeBases, selectedIds: selected.map((d) => d.documentId) });
  } catch (e) { return ragErrorResponse(e); }
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可以创建知识库' }, { status: 403 });
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(await request.json());
    const knowledgeBase = await prisma.knowledgeBase.create({ data: { userId: user.userId, name }, select: { id: true, name: true } });
    return Response.json(knowledgeBase, { status: 201 });
  } catch (e) { return ragErrorResponse(e); }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可以发布知识库' }, { status: 403 });
  try {
    const body = z.union([
      z.object({ id: z.string().min(1), published: z.boolean() }),
      z.object({ action: z.literal('configure'), id: z.string().min(1), visibility: z.enum(['private', 'group', 'public']), groupIds: z.array(z.string()).max(50), chunkingStrategy: z.enum(['recursive', 'semantic']) }),
    ]).parse(await request.json());
    const { id } = body;
    await prisma.$transaction(async (tx) => {
      const bases = await tx.$queryRaw<Array<{ id: string; published: boolean; chunkingStrategy: string }>>`SELECT id, published, "chunkingStrategy" FROM "KnowledgeBase" WHERE id = ${id} AND "userId" = ${user.userId} FOR UPDATE`;
      if (!bases.length) throw new RagError('知识库不存在', 404);
      if ('action' in body) {
        if (bases[0].published) throw new RagError('请先取消发布，再修改知识库设置', 409);
        const groupIds = [...new Set(body.groupIds)];
        if (body.visibility === 'group' && !groupIds.length) throw new RagError('请选择至少一个用户组');
        if (await tx.accessGroup.count({ where: { id: { in: groupIds } } }) !== groupIds.length) throw new RagError('用户组不存在');
        if (body.chunkingStrategy !== bases[0].chunkingStrategy && await tx.document.count({ where: { knowledgeBaseId: id, OR: [{ status: { in: ['queued', 'parsing', 'embedding'] } }, { generations: { some: { status: { in: ['queued','processing'] } } } }] } })) throw new RagError('请等待当前文件处理结束后再修改分块策略', 409);
        await tx.knowledgeGroupGrant.deleteMany({ where: { knowledgeBaseId: id } });
        if (groupIds.length) await tx.knowledgeGroupGrant.createMany({ data: groupIds.map((groupId) => ({ knowledgeBaseId: id, groupId })) });
        await tx.knowledgeBase.update({ where: { id }, data: { visibility: body.visibility, chunkingStrategy: body.chunkingStrategy } });
        return;
      }
      const { published } = body;
      if (published) {
        if (await tx.document.count({ where: { knowledgeBaseId: id, OR: [{ status: { in: ['queued', 'parsing', 'embedding'] } }, { generations: { some: { status: { in: ['queued','processing'] } } } }] } })) throw new RagError('仍有文件或新版本在处理中，请稍后发布', 409);
        const documents = await tx.document.findMany({ where: { knowledgeBaseId: id, isCurrent: true }, select: { status: true, embeddingModel: true, pipelineProfile: true, activeGenerationId: true } });
        const generations = esEnabled() ? await tx.ragGeneration.findMany({ where: { id: { in: documents.flatMap((d) => d.activeGenerationId ? [d.activeGenerationId] : []) }, status: 'ready' } }) : [];
        if (!documents.length || documents.some((d) => d.status !== 'ready' || (esEnabled() ? !generations.some((g) => g.id === d.activeGenerationId && g.profile === generationProfile(bases[0].chunkingStrategy)) : (d.embeddingModel !== embeddingProfile || (d.pipelineProfile && d.pipelineProfile !== pipelineProfile(bases[0].chunkingStrategy)))))) throw new RagError('所有文件处理完成后才能发布；请先重试或重新索引策略变化的文件', 409);
      }
      await tx.knowledgeBase.update({ where: { id }, data: { published } });
    });
    return Response.json({ success: true });
  } catch (e) { return ragErrorResponse(e); }
}
