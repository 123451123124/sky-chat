export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export class SSEParser {
  private buffer = '';

  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    let pos: number;
    while ((pos = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, pos);
      this.buffer = this.buffer.slice(pos + 2);

      const event = this.parseBlock(raw);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private parseBlock(block: string): SSEEvent | null {
    const lines = block.split('\n');
    let event: string | undefined;
    let data = '';
    let id: string | undefined;
    let retry: number | undefined;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trimStart();
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      } else if (line.startsWith('retry:')) {
        const val = parseInt(line.slice(6).trim(), 10);
        if (!isNaN(val)) retry = val;
      }
    }

    if (!data) return null;

    return { event, data, id, retry };
  }

  reset() {
    this.buffer = '';
  }
}
