import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PipelineStage } from '../messaging/contracts';

const root = path.resolve(process.env.RAG_STORAGE_DIR || '.data/rag', '.pipeline');
function directory(generationId: string) { z.string().uuid().parse(generationId); return path.join(root, generationId); }
export async function writeArtifact(generationId: string, stage: PipelineStage, data: unknown, token: string) {
  z.string().uuid().parse(token);
  const dir = directory(generationId); await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `${stage}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(data)); await rename(temporary, path.join(dir, `${stage}-${token}.json`));
}
export async function readArtifact<T>(generationId: string, stage: PipelineStage, schema: z.ZodType<T>, token: string): Promise<T> {
  z.string().uuid().parse(token);
  const bytes = await readFile(path.join(directory(generationId), `${stage}-${token}.json`));
  if (bytes.length > 80 * 1024 * 1024) throw new Error('阶段产物超过大小上限');
  return schema.parse(JSON.parse(bytes.toString('utf8')));
}
export async function removeArtifacts(generationId: string) {
  const dir = directory(generationId);
  if (path.dirname(dir) !== root) throw new Error('无效产物路径');
  await rm(dir, { recursive: true, force: true });
}
export const sectionsSchema = z.array(z.object({ text: z.string(), page: z.number().nullable(), heading: z.string().nullable() })).max(4000);
export const chunksSchema = z.array(z.object({ text: z.string(), page: z.number().nullable(), heading: z.string().nullable(), kind: z.enum(['parent', 'leaf']), parentIndex: z.number().int().nullable() })).max(3200);
export const vectorsSchema = z.array(z.array(z.number().finite()).length(2048)).max(1600);
