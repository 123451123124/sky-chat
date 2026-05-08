export type StreamChunkType =
  | 'text-start'
  | 'text-delta'
  | 'text-end'
  | 'reasoning-start'
  | 'reasoning-delta'
  | 'reasoning-end'
  | 'tool-input-start'
  | 'tool-input-delta'
  | 'tool-input-available'
  | 'tool-output-available'
  | 'tool-output-error'
  | 'step-start'
  | 'finish'
  | 'error'
  | 'abort';

export interface StreamChunk {
  type: StreamChunkType;
  [key: string]: unknown;
}

export function parseAIStreamChunk(data: string): StreamChunk | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as StreamChunk;
    }
    return null;
  } catch {
    return null;
  }
}

export interface StreamCallbacks {
  onTextDelta?: (id: string, delta: string) => void;
  onTextStart?: (id: string) => void;
  onTextEnd?: (id: string) => void;
  onReasoningStart?: (id: string) => void;
  onReasoningDelta?: (id: string, delta: string) => void;
  onReasoningEnd?: (id: string) => void;
  onToolInputStart?: (toolCallId: string, toolName: string) => void;
  onToolInputDelta?: (toolCallId: string, delta: string) => void;
  onToolInputAvailable?: (toolCallId: string, toolName: string, input: unknown) => void;
  onToolOutputAvailable?: (toolCallId: string, output: unknown) => void;
  onToolOutputError?: (toolCallId: string, errorText: string) => void;
  onStepStart?: () => void;
  onFinish?: (finishReason?: string) => void;
  onError?: (errorText: string) => void;
  onAbort?: (reason?: string) => void;
}

export function handleStreamChunk(chunk: StreamChunk, callbacks: StreamCallbacks) {
  switch (chunk.type) {
    case 'text-start':
      callbacks.onTextStart?.(chunk.id as string);
      break;
    case 'text-delta':
      callbacks.onTextDelta?.(chunk.id as string, chunk.delta as string);
      break;
    case 'text-end':
      callbacks.onTextEnd?.(chunk.id as string);
      break;
    case 'reasoning-start':
      callbacks.onReasoningStart?.(chunk.id as string);
      break;
    case 'reasoning-delta':
      callbacks.onReasoningDelta?.(chunk.id as string, chunk.delta as string);
      break;
    case 'reasoning-end':
      callbacks.onReasoningEnd?.(chunk.id as string);
      break;
    case 'tool-input-start':
      callbacks.onToolInputStart?.(chunk.toolCallId as string, chunk.toolName as string);
      break;
    case 'tool-input-delta':
      callbacks.onToolInputDelta?.(chunk.toolCallId as string, chunk.delta as string);
      break;
    case 'tool-input-available':
      callbacks.onToolInputAvailable?.(chunk.toolCallId as string, chunk.toolName as string, chunk.input);
      break;
    case 'tool-output-available':
      callbacks.onToolOutputAvailable?.(chunk.toolCallId as string, chunk.output);
      break;
    case 'tool-output-error':
      callbacks.onToolOutputError?.(chunk.toolCallId as string, chunk.errorText as string);
      break;
    case 'step-start':
      callbacks.onStepStart?.();
      break;
    case 'finish':
      callbacks.onFinish?.(chunk.finishReason as string);
      break;
    case 'error':
      callbacks.onError?.(chunk.errorText as string);
      break;
    case 'abort':
      callbacks.onAbort?.(chunk.reason as string);
      break;
  }
}
