export interface RagSource {
  id: string;
  documentId: string;
  chunkId: string;
  name: string;
  page: number | null;
  heading: string | null;
  excerpt: string;
  score: number;
  stepIds: string[];
}

export interface RagStep {
  id: string;
  tool: string;
  query: string;
  status: 'running' | 'completed' | 'failed' | 'cached';
  durationMs: number;
  sourceIds: string[];
  error?: string;
  retrieval?: RetrievalDiagnostics;
}

export interface RetrievalDiagnostics {
  backend?: 'elasticsearch' | 'postgres'; rescoreApplied?: boolean;
  mode: string; vectorCandidates: number; keywordCandidates: number; fusedCandidates: number;
  rerank: { status: 'applied' | 'disabled' | 'fallback'; model?: string; reason?: string };
  timings: Record<string, number>; embeddingCacheHits: number;
  filters: { documentCount: number; tags: string[] }; expandedParents: number;
  warnings?: string[];
}

export interface RagTrace {
  runId: string;
  question: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exceeded';
  steps: RagStep[];
  sources: RagSource[];
  citedSourceIds: string[];
  invalidCitationCount: number;
  error?: string;
}

export interface RagDocument {
  id: string;
  name: string;
  size: number;
  status: string;
  error: string | null;
  chunkCount: number;
  knowledgeBaseId: string | null;
  createdAt: string;
  needsReindex?: boolean;
  revision?: number; progress?: number; visibility?: string; tags?: string[];
  pipeline?: { id: string; stage: string; status: string; progress: number; error: string | null } | null;
  pendingVersion?: { id: string; revision: number; status: string };
}

export interface ParsedSection { text: string; page: number | null; heading: string | null }

export const MAX_DOCUMENTS_PER_SESSION = 12;
export const MAX_SOURCES = 12;
