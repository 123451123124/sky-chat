import type { RagTrace } from './types';

export interface SourceNode { id: string; kind: 'question' | 'step' | 'source' | 'document'; label: string; position: [number, number, number]; sourceId?: string; cited?: boolean }
export interface SourceGraph { nodes: SourceNode[]; links: Array<{ from: string; to: string }> }

// Stable grouped layout. Coordinates encode layout, never embedding similarity.
export function buildSourceGraph(trace: RagTrace): SourceGraph {
  const nodes: SourceNode[] = [{ id: 'question', kind: 'question', label: trace.question, position: [-5.25, 0, 0] }];
  const links: SourceGraph['links'] = [];
  const place = (index: number, count: number) => ((count - 1) / 2 - index) * 1.5;
  trace.steps.forEach((step, i) => {
    nodes.push({ id: `step:${step.id}`, kind: 'step', label: step.tool === 'planQueries' ? '理解问题' : step.tool === 'readDocument' ? '读取上下文' : step.query, position: [-1.75, place(i, trace.steps.length), -.3] });
    links.push({ from: 'question', to: `step:${step.id}` });
  });
  const docs = [...new Map(trace.sources.map((s) => [s.documentId, s.name])).entries()];
  docs.forEach(([id, name], i) => nodes.push({ id: `document:${id}`, kind: 'document', label: name, position: [5.25, place(i, docs.length), -.3] }));
  trace.sources.forEach((source, i) => {
    const id = `source:${source.id}`;
    nodes.push({ id, kind: 'source', label: `${source.id} · ${source.page ? `第 ${source.page} 页` : source.heading || source.name}`, position: [1.75, place(i, trace.sources.length), .3], sourceId: source.id, cited: trace.citedSourceIds.includes(source.id) });
    for (const stepId of source.stepIds) if (trace.steps.some((s) => s.id === stepId)) links.push({ from: `step:${stepId}`, to: id });
    links.push({ from: id, to: `document:${source.documentId}` });
  });
  return { nodes, links };
}
