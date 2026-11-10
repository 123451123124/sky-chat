import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { textSections } from './chunking';
import { loadFile } from './storage';
import type { ParsedSection } from './types';

export async function parseDocument(id: string, name: string, signal: AbortSignal): Promise<ParsedSection[]> {
  signal.throwIfAborted();
  const bytes = await loadFile(id);
  if (!name.toLowerCase().endsWith('.pdf')) return textSections(new TextDecoder('utf-8', { fatal: true }).decode(bytes), /\.(md|markdown)$/i.test(name));
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdf.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/') + '/' });
  const abort = () => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > 300) throw new Error('PDF 超过 300 页，请拆分后上传');
    const result: ParsedSection[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      signal.throwIfAborted();
      const content = await (await doc.getPage(page)).getTextContent();
      result.push({ page, heading: null, text: content.items.map((item) => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join('') });
    }
    return result;
  } finally { signal.removeEventListener('abort', abort); await task.destroy(); }
}
