import { createHash, randomUUID } from 'node:crypto';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RagError, ragErrorResponse } from '@/lib/rag/access';
import { storeFile, removeFile } from '@/lib/rag/storage';
import { boundedFormData } from '@/lib/rag/upload';
import { kafkaEnabled } from '@/lib/rag/search/config';
import { enqueueGeneration } from '@/lib/rag/messaging/enqueue';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: '仅管理员可以上传资料' }, { status: 403 });
  try {
    const form = await boundedFormData(request);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new RagError('请选择非空文件');
    if (file.size > 10 * 1024 * 1024) throw new RagError('文件不能超过 10 MB', 413);
    if (!/\.(pdf|txt|md|markdown|csv|json|xml|ya?ml|[jt]sx?|py|java|go|rs|html|css|sql)$/i.test(file.name)) throw new RagError('支持 PDF、UTF-8 文本和常用代码文件；图片暂不支持知识检索');
    const name = file.name.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200);
    const knowledgeBaseId = typeof form.get('knowledgeBaseId') === 'string' ? String(form.get('knowledgeBaseId')) : null;
    if (!knowledgeBaseId) throw new RagError('请先选择知识库');
    const base = await prisma.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, userId: user.userId } });
    if (!base) throw new RagError('知识库不存在', 404);
    if (base.published) throw new RagError('请先取消发布，再添加文件', 409);
    const replacesId = typeof form.get('replacesId') === 'string' ? String(form.get('replacesId')) : null;
    const previous = replacesId ? await prisma.document.findFirst({ where: { id: replacesId, userId: user.userId, knowledgeBaseId, isCurrent: true, status: 'ready' }, include: { groupGrants: true, userGrants: true } }) : null;
    if (replacesId && !previous) throw new RagError('待替换文件不可用，请刷新后重试', 409);
    const count = await prisma.document.count({ where: { userId: user.userId } });
    if (count >= 200) throw new RagError('文件库已达到 200 个文件，请先删除不再使用的资料', 409);
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.document.findFirst({ where: { userId: user.userId, knowledgeBaseId, hash, status: { not: 'failed' }, isCurrent: true } });
    if (existing && (!previous || previous.id === existing.id)) return Response.json({ document: existing, documentId: existing.id, fileName: existing.name, fileSize: existing.size }, { status: 200 });
    const id = randomUUID();
    await storeFile(id, bytes);
    try {
      const document = await prisma.$transaction(async (tx) => {
        const bases = await tx.$queryRaw<Array<{ published: boolean }>>`SELECT published FROM "KnowledgeBase" WHERE id = ${knowledgeBaseId} AND "userId" = ${user.userId} FOR UPDATE`;
        if (!bases.length || bases[0].published) throw new RagError('知识库状态已变化，请刷新后重试', 409);
        let revision: number | undefined; let freshPrevious = previous;
        if (previous) {
          freshPrevious = await tx.document.findFirst({ where: { id: previous.id, knowledgeBaseId, isCurrent: true, status: 'ready' }, include: { groupGrants: true, userGrants: true } });
          if (!freshPrevious) throw new RagError('原文件状态已变化，请刷新后重试', 409);
          if (freshPrevious.pendingGenerationId && await tx.ragGeneration.count({where:{id:freshPrevious.pendingGenerationId,status:{in:['queued','processing']}}})) throw new RagError('请等待原文件索引任务完成，再上传新版本',409);
          if (await tx.document.count({ where: { familyId: previous.familyId, replacesId: previous.id, status: { in: ['queued', 'parsing', 'embedding'] } } })) throw new RagError('该文件已有新版本在处理中', 409);
          revision = ((await tx.document.aggregate({ where: { familyId: previous.familyId }, _max: { revision: true } }))._max.revision || 1) + 1;
        }
        const created = await tx.document.create({ data: { id, userId: user.userId, knowledgeBaseId, name, size: file.size, mediaType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain', hash, job: { create: { status: kafkaEnabled() ? 'external' : 'queued' } }, ...(previous ? { isCurrent: false, familyId: previous.familyId, revision, replacesId: previous.id, visibility: freshPrevious!.visibility, tags: freshPrevious!.tags, groupGrants: { create: freshPrevious!.groupGrants.map((g) => ({ groupId: g.groupId })) }, userGrants: { create: freshPrevious!.userGrants.map((g) => ({ userId: g.userId })) } } : {}) } });
        if (kafkaEnabled()) await enqueueGeneration(tx,id);
        return created;
      });
      return Response.json({ document, documentId: id, fileName: name, fileSize: file.size }, { status: 202 });
    } catch (e) { await removeFile(id).catch(() => {}); throw e; }
  } catch (e) { return ragErrorResponse(e); }
}
