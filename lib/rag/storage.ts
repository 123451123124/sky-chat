import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.RAG_STORAGE_DIR || '.data/rag');
function filePath(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid document ID');
  return path.join(root, id);
}
export async function storeFile(id: string, bytes: Buffer) {
  await mkdir(root, { recursive: true });
  await writeFile(filePath(id), bytes, { flag: 'wx' });
}
export const loadFile = (id: string) => readFile(filePath(id));
export async function removeFile(id: string) {
  await unlink(filePath(id)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
}
