import { z } from 'zod';
import { prisma } from '../prisma';
import { MAX_DOCUMENTS_PER_SESSION } from './types';
import { embeddingProfile } from './embedding';
import { Prisma } from '@prisma/client';
import { pipelineProfile } from './splitting';
import { esEnabled } from './search/config';

export class RagError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function ragErrorResponse(error: unknown) {
  if (error instanceof RagError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: '请求格式不正确' }, { status: 400 });
  return Response.json({ error: '资料服务暂时不可用，请稍后重试' }, { status: 503 });
}
export const documentIdsSchema = z.array(z.string().uuid()).max(MAX_DOCUMENTS_PER_SESSION).transform((ids) => [...new Set(ids)]);
// Existing private documents remain private; publication explicitly grants read access.
const groupAccess = (userId: string) => ({ group: { descendants: { some: { descendant: { members: { some: { userId } } } } } } });
export const readableDocuments = (userId: string): Prisma.DocumentWhereInput => ({ OR: [
  { userId },
  { status: 'ready', knowledgeBase: { published: true, OR: [{ visibility: 'public' }, { visibility: 'group', groupGrants: { some: groupAccess(userId) } }] }, OR: [
    { visibility: 'inherit' },
    { visibility: 'restricted', userGrants: { some: { userId } } },
    { visibility: 'restricted', groupGrants: { some: groupAccess(userId) } },
  ] },
] });
// Same policy as the ORM filter, pushed down before each retrieval ranking.
export function documentPermissionSql(userId: string): Prisma.Sql {
  return Prisma.sql`(d."userId" = ${userId} OR (d.status = 'ready' AND EXISTS (
    SELECT 1 FROM "KnowledgeBase" k WHERE k.id = d."knowledgeBaseId" AND k.published = true AND (
      (k.visibility = 'public' OR (k.visibility = 'group' AND EXISTS (
        SELECT 1 FROM "KnowledgeGroupGrant" g JOIN "GroupClosure" gc ON gc."ancestorId" = g."groupId"
        JOIN "GroupMembership" gm ON gm."groupId" = gc."descendantId" WHERE g."knowledgeBaseId" = k.id AND gm."userId" = ${userId})))
      AND (d.visibility = 'inherit' OR (d.visibility = 'restricted' AND (EXISTS (SELECT 1 FROM "DocumentUserGrant" ug WHERE ug."documentId" = d.id AND ug."userId" = ${userId}) OR EXISTS (
        SELECT 1 FROM "DocumentGroupGrant" g JOIN "GroupClosure" gc ON gc."ancestorId" = g."groupId"
        JOIN "GroupMembership" gm ON gm."groupId" = gc."descendantId" WHERE g."documentId" = d.id AND gm."userId" = ${userId}))))
    ))))`;
}
export async function assertSession(userId: string, sessionId: string) {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw new RagError('对话不存在', 404);
  return session;
}
export async function authorizedDocuments(userId: string, ids: string[]) {
  if (esEnabled()) return (await import('./search/retrieval')).esAuthorizedDocuments(userId,ids);
  const documents = await prisma.document.findMany({ where: { ...readableDocuments(userId), id: { in: ids }, isCurrent: true }, select: { id: true, status: true, embeddingModel: true, pipelineProfile: true, knowledgeBase: { select: { chunkingStrategy: true } } } });
  if (documents.length !== ids.length) throw new RagError('部分资料不存在，请重新选择', 404);
  if (documents.some((d) => d.status !== 'ready')) throw new RagError('部分资料尚未就绪，请等待处理或移出检索范围', 409);
  if (documents.some((d) => d.embeddingModel !== embeddingProfile)) throw new RagError('向量模型已变化，请在资料库重新索引这些文件', 409);
  if (documents.some((d) => d.pipelineProfile && d.pipelineProfile !== pipelineProfile(d.knowledgeBase?.chunkingStrategy))) throw new RagError('分块策略已变化，请重新索引资料后再检索', 409);
  return documents;
}
