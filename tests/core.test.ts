import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser } from '../lib/sse-parser';
import { useChatStore } from '../store/useChatStore';
import { StreamBuffer } from '../lib/stream-buffer';

test('SSE preserves events at every possible network chunk boundary', () => {
  const text = 'data: {"type":"text-delta","delta":"你好🌿"}\r\n\r\ndata: {"type":"finish"}\r\n\r\n';
  for (let split = 0; split <= text.length; split++) {
    const parser = new SSEParser();
    const events = [...parser.parse(text.slice(0, split)), ...parser.parse(text.slice(split))];
    assert.deepEqual(events.map((event) => JSON.parse(event.data).type), ['text-delta', 'finish']);
    assert.equal(JSON.parse(events[0].data).delta, '你好🌿');
  }
});

test('SSE preserves multiline data, indentation, comments and empty data', () => {
  const parser = new SSEParser();
  const events = parser.parse(': heartbeat\ndata:   indented\ndata: next\nid: test\nretry: 123x\n\ndata:\n\n');
  assert.equal(events[0].data, '  indented\nnext');
  assert.equal(events[0].id, 'test');
  assert.equal(events[0].retry, undefined);
  assert.equal(events[1].data, '');
});

test('SSE accepts mixed line endings and reset discards unfinished events', () => {
  const parser = new SSEParser();
  assert.equal(parser.parse('data: one\r\rdata: two\n\ndata: three\r\n\r\n').length, 3);
  parser.parse('data: unfinished');
  parser.reset();
  assert.equal(parser.parse('data: fresh\n\n')[0].data, 'fresh');
});

test('SSE dispatches a CR-terminated final event without needing another network chunk', () => {
  const parser = new SSEParser();
  assert.equal(parser.parse('data: final\r\r')[0].data, 'final');
  assert.equal(parser.parse('\n').length, 0);
  assert.equal(parser.parse('data: next\r\n\r\n')[0].data, 'next');
});

test('stopping generation finalizes partial output without clearing history', () => {
  const state = useChatStore.getState;
  state().reset();
  state().addMessage({ id: 'u1', role: 'user', content: '你好', parts: [] });
  state().startAssistantMessage('a1');
  state().appendTextToMessage('a1', '部分回复');
  state().finalizeCurrentMessage();
  state().setStatus('idle');
  assert.equal(state().messages.length, 2);
  assert.equal(state().messages[1].content, '部分回复');
  assert.equal(state().currentAssistantId, null);
  assert.equal(state().messages[1].parts[0].type, 'text');
  assert.deepEqual(state().messages[1].parts[0], { type: 'text', text: '部分回复', state: 'done' });
});

test('clearing an error returns the composer to a sendable state', () => {
  const state = useChatStore.getState;
  state().setError('网络断开');
  assert.equal(state().status, 'error');
  state().setError(null);
  assert.equal(state().status, 'idle');
  assert.equal(state().error, null);
});

test('late text for a previous conversation cannot enter the new conversation', () => {
  const state = useChatStore.getState;
  state().reset();
  state().startAssistantMessage('old');
  state().reset();
  state().addMessage({ id: 'new', role: 'user', content: '新对话', parts: [] });
  state().appendTextToMessage('old', '迟到的旧回复');
  assert.equal(state().messages.length, 1);
  assert.equal(state().messages[0].content, '新对话');
});

test('stream buffer flushes pending text once and destroy cancels old callbacks', () => {
  let callback: FrameRequestCallback | undefined;
  let cancelled = false;
  globalThis.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { cancelled = true; };
  const flushed: string[] = [];
  const buffer = new StreamBuffer();
  buffer.onFlush((text) => flushed.push(text));
  buffer.push('你'); buffer.push('好'); buffer.forceFlush();
  assert.deepEqual(flushed, ['你好']);
  assert.equal(cancelled, true);
  buffer.push('旧内容'); buffer.destroy(); callback?.(0);
  assert.deepEqual(flushed, ['你好']);
});
