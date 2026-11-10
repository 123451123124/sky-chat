import { fork, type ForkOptions } from 'node:child_process';
import path from 'node:path';
import { sectionsSchema } from './artifacts';
export function parseIsolated(id: string, name: string, signal: AbortSignal) {
  return new Promise<ReturnType<typeof sectionsSchema.parse>>((resolve, reject) => {
    signal.throwIfAborted();
    const options: ForkOptions & { windowsHide: boolean } = { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true };
    const child = fork(path.resolve('scripts/rag-parse-child.ts'), [], options);
    let settled = false;
    const finish = (error?: Error, value?: ReturnType<typeof sectionsSchema.parse>) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); child.kill(); if (error) reject(error); else resolve(value!); };
    const abort = () => finish(new DOMException('文件解析已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    child.once('message', (message: { ok?: boolean; sections?: unknown }) => {
      const parsed = sectionsSchema.safeParse(message.sections);
      if (message.ok && parsed.success) finish(undefined, parsed.data);
      else finish(new Error('文件解析失败，请确认 PDF 或 UTF-8 文本可读取'));
    });
    child.once('error', () => finish(new Error('解析子进程无法启动')));
    child.once('exit', () => { if (!settled) finish(new Error('文件解析进程中断')); });
    child.send({ id, name });
  });
}
