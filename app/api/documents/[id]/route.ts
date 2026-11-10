import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RagError, ragErrorResponse, readableDocuments } from '@/lib/rag/access';
import { loadFile, removeFile } from '@/lib/rag/storage';
import type { Prisma } from '@prisma/client';
import { clearEmbeddingMemoryCache } from '@/lib/rag/embedding';
import { clearSearchMemory } from '@/lib/rag/search/embedding';
import { kafkaEnabled } from '@/lib/rag/search/config';
import { enqueueGeneration } from '@/lib/rag/messaging/enqueue';

type Context = { params: Promise<{ id: string }> };
async function owned(userId: string, id: string) {
  const document = await prisma.document.findFirst({ where: { id, userId }, include: { knowledgeBase: { select: { published: true } } } });
  if (!document) throw new RagError('资料不存在', 404);
  if (document.knowledgeBase?.published) throw new RagError('请先取消发布，再维护文件', 409);
  return document;
}
async function lockDraft(tx: Prisma.TransactionClient, knowledgeBaseId: string | null, userId: string) {
  if (!knowledgeBaseId) return;
  const rows = await tx.$queryRaw<Array<{ published: boolean }>>`SELECT published FROM "KnowledgeBase" WHERE id = ${knowledgeBaseId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length || rows[0].published) throw new RagError('请先取消发布，再维护文件', 409);
}
export async function GET(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const document = await prisma.document.findFirst({ where: { id: (await params).id, ...readableDocuments(user.userId) }, select: { id: true, userId: true, familyId: true, name: true, size: true, status: true, error: true, chunkCount: true, revision: true, progress: true, activeGenerationId: true } });
    if (!document) throw new RagError('资料不存在或尚未发布', 404);
    const url = new URL(request.url);
    if (url.searchParams.get('versions') === '1') {
      const versions = await prisma.document.findMany({ where: { ...readableDocuments(user.userId), familyId: document.familyId }, select: { id: true, name: true, revision: true, isCurrent: true, status: true, createdAt: true }, orderBy: { revision: 'desc' } });
      return Response.json({ versions });
    }
    if (url.searchParams.get('preview') === '1') {
      if (user.role !== 'admin' || document.userId !== user.userId) throw new RagError('仅所有者可以查看处理预览', 403);
      const offset = Math.max(0, Math.min(3000, Number(url.searchParams.get('offset')) || 0));
      const [chunks, detail, total] = await Promise.all([
        prisma.chunk.findMany({ where: { documentId: document.id, generationId: document.activeGenerationId || null }, orderBy: { ordinal: 'asc' }, skip: offset, take: 30, select: { id: true, ordinal: true, kind: true, parentId: true, text: true, page: true, heading: true } }),
        prisma.document.findUnique({ where: { id: document.id }, select: { pipelineProfile: true, ingestionMetrics: true, job: { select: { attempts: true, status: true, errorCode: true, lastError: true } } } }),
        prisma.chunk.count({ where: { documentId: document.id, generationId: document.activeGenerationId || null } }),
      ]);
      return Response.json({ document: { id: document.id, name: document.name }, chunks, total, offset, detail });
    }
    if (url.searchParams.get('download') === '1') {
      const bytes = await loadFile(document.id);
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const chunkId = url.searchParams.get('chunkId');
    if (chunkId) {
      const chunk = await prisma.chunk.findFirst({ where: { id: chunkId, documentId: document.id }, select: { id: true, text: true, page: true, heading: true } });
      if (!chunk) throw new RagError('来源片段已不可用', 404);
      return Response.json({ document: { id: document.id, name: document.name }, chunk });
    }
    return Response.json({ document });
  } catch (e) { return ragErrorResponse(e); }
}
export async function PATCH(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可以维护资料' }, { status: 403 });
  try {
    const document = await owned(user.userId, (await params).id);
    const body = z.discriminatedUnion('action', [z.object({ action: z.enum(['retry', 'reindex']) }), z.object({ action: z.literal('move'), knowledgeBaseId: z.string().min(1) }), z.object({ action: z.literal('permissions'), visibility: z.enum(['inherit', 'private', 'restricted']), groupIds: z.array(z.string()).max(50), userIds: z.array(z.string()).max(100), tags: z.array(z.string().trim().min(1).max(60)).max(20) })]).parse(await request.json());
    if (body.action === 'permissions') {
      await prisma.$transaction(async (tx) => {
        await lockDraft(tx, document.knowledgeBaseId, user.userId);
        const groupIds = [...new Set(body.groupIds)]; const userIds = [...new Set(body.userIds)];
        if (body.visibility === 'restricted' && !groupIds.length && !userIds.length) throw new RagError('限定访问需要至少一个用户或用户组');
        if (await tx.accessGroup.count({ where: { id: { in: groupIds } } }) !== groupIds.length || await tx.user.count({ where: { id: { in: userIds } } }) !== userIds.length) throw new RagError('授权对象不存在');
        const versions = await tx.document.findMany({ where: { familyId: document.familyId, userId: user.userId }, select: { id: true } });
        const ids = versions.map((v) => v.id);
        await tx.documentGroupGrant.deleteMany({ where: { documentId: { in: ids } } });
        await tx.documentUserGrant.deleteMany({ where: { documentId: { in: ids } } });
        if (groupIds.length) await tx.documentGroupGrant.createMany({ data: ids.flatMap((documentId) => groupIds.map((groupId) => ({ documentId, groupId }))) });
        if (userIds.length) await tx.documentUserGrant.createMany({ data: ids.flatMap((documentId) => userIds.map((userId) => ({ documentId, userId }))) });
        await tx.document.updateMany({ where: { id: { in: ids } }, data: { visibility: body.visibility, tags: [...new Set(body.tags)] } });
      });
      return Response.json({ success: true });
    }
    if (body.action === 'move') {
      await prisma.$transaction(async (tx) => {
        for (const id of [...new Set([document.knowledgeBaseId, body.knowledgeBaseId].filter((id): id is string => !!id))].sort()) await lockDraft(tx, id, user.userId);
        if (await tx.ragGeneration.count({where:{document:{familyId:document.familyId},status:{in:['queued','processing']}}})) throw new RagError('请等待索引任务结束后再移动文件',409);
        await tx.document.updateMany({ where: { familyId: document.familyId, userId: user.userId }, data: { knowledgeBaseId: body.knowledgeBaseId } });
      });
      return Response.json({ success: true });
    }
    {
      const requiredStatus = body.action === 'retry' ? 'failed' : 'ready';
      if (document.status !== requiredStatus) throw new RagError('当前状态无法重试或重新索引，请等待处理结束', 409);
      if (body.action === 'reindex' && !document.isCurrent) throw new RagError('请在当前启用版本上重新索引',409);
      await prisma.$transaction(async (tx) => {
        await lockDraft(tx, document.knowledgeBaseId, user.userId);
        if (body.action === 'retry' && document.replacesId && !await tx.document.findFirst({ where: { id: document.replacesId, isCurrent: true }, select: { id: true } })) throw new RagError('该版本已被后续版本取代，请重新上传新版本', 409);
        if (kafkaEnabled()) {
          await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${document.id} FOR UPDATE`;
          const fresh = await tx.document.findUniqueOrThrow({where:{id:document.id}});
          if(fresh.knowledgeBaseId!==document.knowledgeBaseId || fresh.status!==requiredStatus) throw new RagError('文件状态或分组已变化，请刷新后重试',409);
          await enqueueGeneration(tx,document.id);
          return;
        }
        const updated = await tx.document.updateMany({ where: { id: document.id, userId: user.userId, status: requiredStatus }, data: { status: 'queued', error: null } });
        if (!updated.count) throw new RagError('任务状态已变化，请刷新', 409);
        await tx.ingestionJob.upsert({ where: { documentId: document.id }, create: { documentId: document.id }, update: { status: 'queued', attempts: 0, leasedBy: null, heartbeatAt: null, availableAt: new Date(), errorCode: null, lastError: null } });
      });
    }
    return Response.json({ success: true });
  } catch (e) { return ragErrorResponse(e); }
}
export async function DELETE(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可以维护资料' }, { status: 403 });
  try {
    const document = await owned(user.userId, (await params).id);
    const versionOnly = new URL(request.url).searchParams.get('versionOnly') === '1';
    const versions = await prisma.$transaction(async (tx) => {
      await lockDraft(tx, document.knowledgeBaseId, user.userId);
      const cleanupGenerations = await tx.ragGeneration.findMany({ where: { document: { userId: user.userId, ...(versionOnly ? { id: document.id } : { familyId: document.familyId }) } }, select: { id: true } });
      if (cleanupGenerations.length) await tx.ragIndexCleanup.createMany({ data: cleanupGenerations.map((g) => ({ generationId: g.id, availableAt: new Date(Date.now()+300000) })), skipDuplicates: true });
      if (versionOnly) {
        const deleted = await tx.document.deleteMany({ where: { id: document.id, isCurrent: false, userId: user.userId } });
        if (!deleted.count) throw new RagError('当前启用版本不能单独删除，请刷新后重试', 409);
        await tx.embeddingCache.deleteMany({ where: { userId: user.userId } });
        await tx.ragVectorCache.deleteMany({ where: { userId: user.userId } });
        return [{ id: document.id }];
      }
      const versions = await tx.document.findMany({ where: { familyId: document.familyId, userId: user.userId }, select: { id: true } });
      await tx.document.deleteMany({ where: { familyId: document.familyId, userId: user.userId } });
      await tx.embeddingCache.deleteMany({ where: { userId: user.userId } });
      await tx.ragVectorCache.deleteMany({ where: { userId: user.userId } });
      return versions;
    });
    clearEmbeddingMemoryCache(user.userId);
    clearSearchMemory(user.userId);
    await Promise.all(versions.map((v) => removeFile(v.id).catch(() => { console.error('Original document cleanup failed', v.id); })));
    return Response.json({ success: true });
  } catch (e) { return ragErrorResponse(e); }
}
