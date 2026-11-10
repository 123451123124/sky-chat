export function retrievalMetrics(retrieved: string[], relevant: string[], k = 5) {
  const gold = new Set(relevant); const seen = new Set<string>();
  let dcg = 0; let hits = 0; let first = 0;
  retrieved.slice(0, k).forEach((id, i) => { if (gold.has(id) && !seen.has(id)) { hits++; dcg += 1 / Math.log2(i + 2); if (!first) first = 1 / (i + 1); } seen.add(id); });
  const ideal = Array.from({ length: Math.min(k, gold.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a,b) => a + b, 0);
  return { recallAt5: gold.size ? hits / gold.size : 0, mrr: first, ndcgAt5: ideal ? dcg / ideal : 0 };
}
export function percentile(values: number[], p: number) { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] || 0; }
