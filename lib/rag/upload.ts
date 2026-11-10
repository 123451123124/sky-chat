import { RagError } from './access';

export async function boundedFormData(request: Request, limit = 11 * 1024 * 1024): Promise<FormData> {
  if (Number(request.headers.get('content-length')) > limit) throw new RagError('文件不能超过 10 MB', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RagError('请选择文件');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new RagError('文件不能超过 10 MB', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
}
