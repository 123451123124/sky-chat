import type { RagSource } from '../rag/types';

export function verifyCitations(text: string, runId: string, sources: RagSource[]) {
  const allowed = new Set(sources.map((s) => s.id));
  const cited = new Set<string>();
  let invalid = 0;
  let content = text.replace(/\[([^\]\n]*)\]\(#rag-([^)]*)\)/g, (_match, label: string, target: string) => {
    const id = target.startsWith(`${runId}-`) ? target.slice(runId.length + 1) : '';
    if (!allowed.has(id)) { invalid++; return `${label}（来源未核实）`; }
    cited.add(id);
    return `[${label}](#rag-${runId}-${id})`;
  });
  content = content.replace(/\[(S\d+)\](?!\()/g, (_match, id: string) => {
    if (!allowed.has(id)) { invalid++; return `${id}（来源未核实）`; }
    cited.add(id);
    return `[${id}](#rag-${runId}-${id})`;
  });
  return { content, citedSourceIds: [...cited], invalidCitationCount: invalid };
}
