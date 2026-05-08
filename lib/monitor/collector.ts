import type { SSEMetric, PerformanceMetric } from './types';
import { addToQueue, getQueue, clearQueue } from './indexeddb';
import { sendReport } from './reporter';

const STALL_THRESHOLD = 500;

interface SSETrackerOptions {
  sessionId?: string;
  url?: string;
}

export class SSEPerformanceTracker {
  private startTime = 0;
  private firstByteTime = 0;
  private lastChunkTime = 0;
  private chunkCount = 0;
  private stallCount = 0;
  private totalStallDuration = 0;
  private currentStallStart = 0;
  private phaseStartTimes: Record<string, number> = {};
  private phaseDurations: Record<string, number> = {};
  private options: SSETrackerOptions;
  private metricId: string;

  constructor(options: SSETrackerOptions = {}) {
    this.options = options;
    this.metricId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  start() {
    this.startTime = performance.now();
    this.phaseStartTimes['thinking'] = this.startTime;
  }

  onFirstChunk() {
    this.firstByteTime = performance.now();
  }

  onChunk() {
    const now = performance.now();

    if (this.chunkCount === 0) {
      this.firstByteTime = now;
    }

    if (this.lastChunkTime > 0) {
      const gap = now - this.lastChunkTime;
      if (gap > STALL_THRESHOLD) {
        this.stallCount++;
        this.totalStallDuration += gap;
      }
    }

    this.lastChunkTime = now;
    this.chunkCount++;
  }

  onPhaseChange(phase: 'thinking' | 'tool_calling' | 'answering') {
    const now = performance.now();
    const currentPhase = Object.keys(this.phaseStartTimes).pop();
    if (currentPhase) {
      this.phaseDurations[currentPhase] = now - this.phaseStartTimes[currentPhase];
    }
    this.phaseStartTimes[phase] = now;
  }

  async finish(): Promise<SSEMetric> {
    const now = performance.now();
    const currentPhase = Object.keys(this.phaseStartTimes).pop();
    if (currentPhase && !this.phaseDurations[currentPhase]) {
      this.phaseDurations[currentPhase] = now - this.phaseStartTimes[currentPhase];
    }

    const ttfb = this.firstByteTime > 0 ? this.firstByteTime - this.startTime : 0;
    const ttlb = now - this.startTime;

    const metric: SSEMetric = {
      id: this.metricId,
      type: 'ttfb',
      name: 'sse-ttfb',
      value: ttfb,
      timestamp: Date.now(),
      url: this.options.url || window.location.href,
      sessionId: this.options.sessionId,
      chunkCount: this.chunkCount,
      stallCount: this.stallCount,
      stallDuration: this.totalStallDuration,
      phaseDurations: this.phaseDurations as SSEMetric['phaseDurations'],
    };

    await addToQueue(metric);

    const ttlbMetric: SSEMetric = {
      id: `${this.metricId}-ttlb`,
      type: 'ttlb',
      name: 'sse-ttlb',
      value: ttlb,
      timestamp: Date.now(),
      url: this.options.url || window.location.href,
      sessionId: this.options.sessionId,
      chunkCount: this.chunkCount,
      stallCount: this.stallCount,
      stallDuration: this.totalStallDuration,
    };

    await addToQueue(ttlbMetric);

    if (this.stallCount > 0) {
      const stallMetric: SSEMetric = {
        id: `${this.metricId}-stall`,
        type: 'stall',
        name: 'sse-stall',
        value: this.totalStallDuration,
        timestamp: Date.now(),
        url: this.options.url || window.location.href,
        sessionId: this.options.sessionId,
        chunkCount: this.chunkCount,
        stallCount: this.stallCount,
        stallDuration: this.totalStallDuration,
      };
      await addToQueue(stallMetric);
    }

    return metric;
  }
}

export class WebVitalsCollector {
  static async collect(): Promise<PerformanceMetric[]> {
    const metrics: PerformanceMetric[] = [];

    if (typeof window === 'undefined') return metrics;

    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navEntry) {
      metrics.push({
        id: `nav-ttfb-${Date.now()}`,
        type: 'ttfb',
        name: 'navigation-ttfb',
        value: navEntry.responseStart - navEntry.requestStart,
        timestamp: Date.now(),
        url: window.location.href,
      });
    }

    return metrics;
  }

  static async observeLCP(): Promise<void> {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          const metric: PerformanceMetric = {
            id: `lcp-${Date.now()}`,
            type: 'lcp',
            name: 'largest-contentful-paint',
            value: lastEntry.startTime,
            timestamp: Date.now(),
            url: window.location.href,
          };
          addToQueue(metric);
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // LCP observation not supported
    }
  }

  static async observeCLS(): Promise<void> {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

    try {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as { hadRecentInput?: boolean }).hadRecentInput) {
            clsValue += (entry as unknown as { value: number }).value;
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });

      const reportCLS = () => {
        if (clsValue > 0) {
          const metric: PerformanceMetric = {
            id: `cls-${Date.now()}`,
            type: 'cls',
            name: 'cumulative-layout-shift',
            value: clsValue,
            timestamp: Date.now(),
            url: window.location.href,
          };
          addToQueue(metric);
        }
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          reportCLS();
        }
      });
    } catch {
      // CLS observation not supported
    }
  }
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL = 10000;
const MAX_BATCH_SIZE = 20;

export async function flushQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const batch = queue.slice(0, MAX_BATCH_SIZE);
  const report = {
    metrics: batch,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
  };

  const success = await sendReport(report);
  if (success) {
    await clearQueue(batch.map((m) => m.id));
  }
}

export function startAutoFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushQueue, FLUSH_INTERVAL);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushQueue();
    }
  });

  window.addEventListener('beforeunload', () => {
    flushQueue();
  });
}

export function stopAutoFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
