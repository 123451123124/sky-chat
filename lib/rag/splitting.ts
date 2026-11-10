import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embedCachedTexts, embeddingProfile, type EmbeddingStats } from './embedding';
import type { ParsedSection } from './types';

export const pipelineProfile = (strategy = 'recursive') => `parent-child:v3:langchain-1:unicode:parent1800:child480:overlap60:${strategy}:${embeddingProfile}`;
const separators = ['\n\n', '\n', '。', '！', '？', '；', '. ', ' ', ''];
class UnicodeRecursiveSplitter extends RecursiveCharacterTextSplitter {
  protected splitOnSeparator(text: string, separator: string) { return separator ? super.splitOnSeparator(text, separator) : Array.from(text); }
}
const lengthFunction = (text: string) => Array.from(text).length;
const parentSplitter = new UnicodeRecursiveSplitter({ chunkSize: 1800, chunkOverlap: 0, separators, lengthFunction });
const childSplitter = new UnicodeRecursiveSplitter({ chunkSize: 480, chunkOverlap: 60, separators, lengthFunction });
const semanticSplitter = new UnicodeRecursiveSplitter({ chunkSize: 360, chunkOverlap: 0, separators, lengthFunction });
export interface HierarchicalChunk extends ParsedSection { parentIndex: number | null; kind: 'parent' | 'leaf' }
export function cosine(a: number[], b: number[]) {
  let dot = 0; let x = 0; let y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}
export function semanticGroups(texts: string[], vectors: number[][]): string[] {
  if (texts.length < 2) return texts;
  const distances = vectors.slice(1).map((v, i) => 1 - cosine(vectors[i], v));
  const sorted = [...distances].sort((a, b) => a - b);
  const boundary = Math.max(.15, sorted[Math.floor((sorted.length - 1) * .75)]);
  const groups: string[] = []; let current = texts[0];
  for (let i = 1; i < texts.length; i++) {
    if (current.length + texts[i].length > 1800 || (distances[i - 1] > boundary && current.length >= 360)) { groups.push(current); current = texts[i]; }
    else current += '\n' + texts[i];
  }
  if (current) groups.push(current);
  return groups;
}
export async function splitHierarchical(sections: ParsedSection[], strategy: string, userId: string, signal: AbortSignal, stats?: EmbeddingStats, embed: typeof embedCachedTexts = embedCachedTexts): Promise<HierarchicalChunk[]> {
  const parents: HierarchicalChunk[] = []; const leaves: HierarchicalChunk[] = [];
  for (const section of sections) {
    signal.throwIfAborted();
    const text = section.text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    if (!text) continue;
    let parentTexts: string[];
    if (strategy === 'semantic') {
      const spans = await semanticSplitter.splitText(text);
      if (spans.length > 800) throw new Error('文档分块超过语义处理上限，请拆分文件');
      const vectors = spans.length > 1 ? await embed(userId, spans, signal, stats) : [];
      parentTexts = spans.length > 1 ? semanticGroups(spans, vectors) : spans;
    } else parentTexts = await parentSplitter.splitText(text);
    for (const parentText of parentTexts) {
      const parentIndex = parents.length;
      parents.push({ ...section, text: parentText, kind: 'parent', parentIndex: null });
      for (const child of await childSplitter.splitText(parentText)) leaves.push({ ...section, text: child, kind: 'leaf', parentIndex });
      if (leaves.length > 1600) throw new Error('文档分块超过 1600 个，请拆分文件后上传');
    }
  }
  return [...parents, ...leaves];
}
