export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/** Incremental SSE parser: accepts LF, CRLF and CR even across chunk boundaries. */
export class SSEParser {
  private buffer = '';
  private lines: string[] = [];
  private skipNextLF = false;

  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    if (this.skipNextLF && this.buffer.length) {
      if (this.buffer.startsWith('\n')) this.buffer = this.buffer.slice(1);
      this.skipNextLF = false;
    }
    const events: SSEEvent[] = [];
    let end: number;
    while ((end = this.buffer.search(/[\r\n]/)) !== -1) {
      const carriageReturn = this.buffer[end] === '\r';
      // Process CR immediately; skip a paired LF arriving in the next chunk.
      this.skipNextLF = carriageReturn && end === this.buffer.length - 1;
      const line = this.buffer.slice(0, end);
      const separatorLength = carriageReturn && this.buffer[end + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(end + separatorLength);
      if (line === '') {
        const event = this.parseBlock(this.lines);
        this.lines = [];
        if (event) events.push(event);
      } else this.lines.push(line);
    }
    return events;
  }

  private parseBlock(lines: string[]): SSEEvent | null {
    let event: string | undefined;
    const data: string[] = [];
    let id: string | undefined;
    let retry: number | undefined;
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id' && !value.includes('\0')) id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
    }
    return data.length ? { event, data: data.join('\n'), id, retry } : null;
  }

  reset() { this.buffer = ''; this.lines = []; this.skipNextLF = false; }
}
