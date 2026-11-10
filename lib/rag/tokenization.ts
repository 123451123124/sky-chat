// ICU word segmentation supports Chinese without requiring a Postgres extension.
// Keep identifiers intact and add character bigrams for unseen CJK compounds.
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stop = new Set(['的', '了', '是', '和', '在', '有', '请', '什么', '多少', '怎么', '如何', 'the', 'a', 'an', 'is', 'of', 'to']);
export function tokenize(text: string): string[] {
  const value = text.normalize('NFKC').toLowerCase();
  const words = [...segmenter.segment(value)].filter((s) => s.isWordLike).map((s) => s.segment).filter((s) => !stop.has(s));
  const identifiers = value.match(/[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+/g) || [];
  const bigrams = [...value.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([run]) => {
    const characters = Array.from(run);
    return Array.from({ length: Math.min(characters.length - 1, 256) }, (_, i) => characters.slice(i, i + 2).join(''));
  }).filter((s) => !stop.has(s));
  return [...words, ...identifiers, ...bigrams];
}
export function searchTerms(query: string) { return [...new Set(tokenize(query))].slice(0, 40); }
