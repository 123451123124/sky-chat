type FlushCallback = (bufferedDelta: string) => void;

export class StreamBuffer {
  private queue: string[] = [];
  private rafId: number | null = null;
  private flushCallback: FlushCallback | null = null;
  private readonly FLUSH_INTERVAL = 2;

  onFlush(callback: FlushCallback) {
    this.flushCallback = callback;
  }

  push(delta: string) {
    this.queue.push(delta);

    if (this.rafId === null) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush() {
    this.rafId = requestAnimationFrame(() => {
      this.flush();
      this.rafId = null;

      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    });
  }

  private flush() {
    if (this.queue.length === 0 || !this.flushCallback) return;

    const batch = this.queue.splice(0, this.queue.length);
    const combined = batch.join('');
    this.flushCallback(combined);
  }

  forceFlush() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flush();
  }

  destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.queue = [];
    this.flushCallback = null;
  }
}
