import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { isValidModel, DEFAULT_MODEL } from '@/lib/models';
import { prisma } from '@/lib/prisma';
import { runAgent } from '@/lib/agent/runtime';
import { assertSession, authorizedDocuments, ragErrorResponse } from '@/lib/rag/access';

export const runtime = 'nodejs';
const requestSchema = z.object({
  sessionId: z.string().min(1).max(100).optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(60000) })).min(1).max(50),
  model: z.string().optional(), searchEnabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: '尚未配置模型服务密钥' }, { status: 503 });
  let body: z.infer<typeof requestSchema>;
  let documentIds: string[] = [];
  try {
    body = requestSchema.parse(await req.json());
    if (body.messages.at(-1)?.role !== 'user' || body.messages.reduce((n, m) => n + m.content.length, 0) > 120000) return Response.json({ error: '消息过长或格式不正确，请新建对话或缩短内容' }, { status: 400 });
    if (body.sessionId) {
      await assertSession(user.userId, body.sessionId);
      const selected = await prisma.sessionDocument.findMany({ where: { sessionId: body.sessionId }, select: { documentId: true } });
      documentIds = selected.map((d) => d.documentId);
      await authorizedDocuments(user.userId, documentIds);
    }
  } catch (error) { return ragErrorResponse(error); }

  const abort = new AbortController();
  const signal = AbortSignal.any([req.signal, abort.signal, AbortSignal.timeout(150000)]);
  let cancelled = false;
  let sequence = 0;
  let runId: string | undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, data: Record<string, unknown> = {}) => {
        if (cancelled) return;
        if (type === 'rag-trace' && data.trace && typeof data.trace === 'object' && 'runId' in data.trace) runId = String(data.trace.runId);
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, sequence: ++sequence, ...(runId ? { runId } : {}), ...data })}\n\n`)); }
        catch { cancelled = true; abort.abort(); }
      };
      const heartbeat = setInterval(() => { if (!cancelled) { try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { cancelled = true; abort.abort(); } } }, 12000);
      try {
        await runAgent({ userId: user.userId, sessionId: body.sessionId, documentIds, messages: body.messages, model: body.model && isValidModel(body.model) ? body.model : DEFAULT_MODEL, searchEnabled: body.searchEnabled === true, signal, emit });
        if (signal.aborted && !cancelled) emit('error', { errorText: '请求已中断或超过时限，已保留收到的内容，请重试' });
      } finally { clearInterval(heartbeat); if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
