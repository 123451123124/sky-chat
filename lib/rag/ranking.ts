// RRF formulation adapted from the pgvector-python hybrid_search/rrf.py example (MIT).
export function reciprocalRankFusion<T extends { id: string }>(lists: Array<{ items: T[]; weight?: number }>, k = 60): Array<T & { fusionScore: number }> {
  const scores = new Map<string, T & { fusionScore: number }>();
  for (const { items, weight = 1 } of lists) {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) return; seen.add(item.id);
      const current = scores.get(item.id) || { ...item, fusionScore: 0 };
      current.fusionScore += weight / (k + index + 1); scores.set(item.id, current);
    });
  }
  return [...scores.values()].sort((a, b) => b.fusionScore - a.fusionScore || a.id.localeCompare(b.id));
}
export function diversify<T extends { id: string; documentId: string; parentId?: string | null }>(items: T[], topK: number): T[] {
  const selected: T[] = []; const seen = new Set<string>(); const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.parentId || item.id;
    if (seen.has(key) || (counts.get(item.documentId) || 0) >= Math.max(2, Math.ceil(topK / 2))) continue;
    selected.push(item); seen.add(key); counts.set(item.documentId, (counts.get(item.documentId) || 0) + 1);
    if (selected.length === topK) return selected;
  }
  for (const item of items) { const key = item.parentId || item.id; if (!seen.has(key)) { selected.push(item); seen.add(key); } if (selected.length === topK) break; }
  return selected;
}
