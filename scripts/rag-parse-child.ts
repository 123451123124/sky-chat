import { parseDocument } from '../lib/rag/parsing';
import { z } from 'zod';
process.once('message', async (input) => {
  try {
    const data = z.object({ id: z.string().uuid(), name: z.string().max(200) }).parse(input);
    const sections = await parseDocument(data.id, data.name, AbortSignal.timeout(180000));
    process.send?.({ ok: true, sections }, () => process.disconnect());
  } catch { process.send?.({ ok: false }, () => process.disconnect()); }
});
