import type { ParsedSection } from './types';

// Bound both CJK text (roughly one token/character) and long unbroken input.
export function chunkSections(sections: ParsedSection[], size = 900, overlap = 120): ParsedSection[] {
  if (size < 100 || overlap < 0 || overlap >= size) throw new Error('Invalid chunk sizes');
  const chunks: ParsedSection[] = [];
  for (const section of sections) {
    const text = section.text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const window = text.slice(start + Math.floor(size * .65), end);
        const boundary = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '));
        if (boundary >= 0) end = start + Math.floor(size * .65) + boundary + 1;
      }
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const part = text.slice(start, end).trim();
      if (part) chunks.push({ ...section, text: part });
      if (chunks.length > 1600) throw new Error('文档分块超过 1600 个，请拆分文件后上传');
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlap);
      if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
    }
  }
  return chunks;
}

export function textSections(text: string, markdown = false): ParsedSection[] {
  if (!markdown) return [{ text, page: null, heading: null }];
  const result: ParsedSection[] = [];
  let heading: string | null = null;
  let content: string[] = [];
  let fenced = false;
  const headings: string[] = [];
  let hasBody = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^#{1,6}\s+/.test(line)) {
      if (hasBody) { result.push({ text: content.join('\n'), page: null, heading }); content = []; hasBody = false; }
      const depth = line.match(/^#+/)![0].length;
      headings.length = depth;
      headings[depth - 1] = line.replace(/^#+\s+/, '').trim();
      heading = headings.filter(Boolean).join(' › ').slice(0, 200);
    } else if (line.trim()) {
      hasBody = true;
    }
    content.push(line);
  }
  if (content.join('\n').trim()) result.push({ text: content.join('\n'), page: null, heading });
  return result;
}
