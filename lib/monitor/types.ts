export interface PerformanceMetric {
  id: string;
  type: 'ttfb' | 'ttlb' | 'stall' | 'fcp' | 'lcp' | 'cls' | 'fid';
  name: string;
  value: number;
  timestamp: number;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface SSEMetric extends PerformanceMetric {
  type: 'ttfb' | 'ttlb' | 'stall';
  sessionId?: string;
  chunkCount?: number;
  stallCount?: number;
  stallDuration?: number;
  phaseDurations?: {
    thinking: number;
    toolCalling: number;
    answering: number;
  };
}

export interface MetricReport {
  metrics: PerformanceMetric[];
  url: string;
  userAgent: string;
  timestamp: number;
  sessionId?: string;
}
