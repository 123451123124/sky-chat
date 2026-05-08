import type { MetricReport } from './types';

const REPORT_URL = '/api/monitor';

export function sendWithBeacon(report: MetricReport): boolean {
  const payload = JSON.stringify(report);
  return navigator.sendBeacon(REPORT_URL, payload);
}

export async function sendWithFetch(report: MetricReport): Promise<boolean> {
  try {
    const response = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendReport(report: MetricReport): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const success = sendWithBeacon(report);
    if (success) return true;
  }

  return sendWithFetch(report);
}
