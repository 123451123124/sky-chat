import { setTimeout as delay } from 'node:timers/promises';

export class ProviderError extends Error {
  constructor(public status: number, public retryAfterMs = 0) { super(`模型服务暂时不可用（${status}）`); }
  get retryable() { return this.status === 429 || this.status >= 500; }
}
export function retryDelay(attempt: number, after = 0, jitter = Math.random()) { return Math.min(15000, Math.max(after, 400 * 2 ** attempt + jitter * 300)); }
export async function requestWithRetry(operation: () => Promise<Response>, signal: AbortSignal | undefined, onRetry?: (status: number) => void): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await operation();
      if (response.ok) return response;
      const retryAfter = response.headers.get('retry-after');
      const seconds = Number(retryAfter);
      const ms = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
      await response.body?.cancel();
      throw new ProviderError(response.status, ms);
    } catch (error) {
      signal?.throwIfAborted();
      const retryable = error instanceof ProviderError ? error.retryable : error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
      if (!retryable || attempt >= 3) throw error;
      onRetry?.(error instanceof ProviderError ? error.status : 0);
      await delay(retryDelay(attempt, error instanceof ProviderError ? error.retryAfterMs : 0), undefined, { signal });
    }
  }
}
