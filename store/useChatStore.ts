import { create } from 'zustand';

export type ChatStatus = 'idle' | 'thinking' | 'tool_calling' | 'answering' | 'error';

export interface TextPart {
  type: 'text';
  text: string;
  state?: 'streaming' | 'done';
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';
}

export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
}

export interface ToolPart {
  type: 'tool';
  tool: ToolInvocation;
}

export interface StepStartPart {
  type: 'step-start';
}

export type MessagePart = TextPart | ReasoningPart | ToolPart | StepStartPart;

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: MessagePart[];
}

interface ChatState {
  status: ChatStatus;
  messages: Message[];
  error: string | null;
  currentAssistantId: string | null;

  setStatus: (status: ChatStatus) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  appendTextDelta: (delta: string) => void;
  appendTextToMessage: (messageId: string, delta: string) => void;
  startAssistantMessage: (id: string) => void;
  addReasoningPart: (id: string) => void;
  appendReasoningDelta: (delta: string) => void;
  addToolPart: (toolInvocation: ToolInvocation) => void;
  updateToolInput: (toolCallId: string, input: unknown, state?: ToolInvocation['state']) => void;
  updateToolOutput: (toolCallId: string, output: unknown) => void;
  updateToolError: (toolCallId: string, errorText: string) => void;
  finalizeCurrentMessage: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

function createAssistantMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    parts: [],
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  status: 'idle',
  messages: [],
  error: null,
  currentAssistantId: null,

  setStatus: (status) => set({ status }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  startAssistantMessage: (id) => set((state) => ({
    currentAssistantId: id,
    messages: [...state.messages, createAssistantMessage(id)],
  })),

  appendTextToMessage: (messageId, delta) => {
    const state = get();
    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg;

        const parts = [...msg.parts];
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart.type === 'text' && lastPart.state === 'streaming') {
          parts[parts.length - 1] = {
            ...lastPart,
            text: lastPart.text + delta,
          };
        } else {
          parts.push({ type: 'text', text: delta, state: 'streaming' });
        }

        return { ...msg, parts, content: msg.content + delta };
      }),
    });
  },

  // 通过 currentAssistantId 追加
  appendTextDelta: (delta) => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;

        const parts = [...msg.parts];
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart.type === 'text' && lastPart.state === 'streaming') {
          parts[parts.length - 1] = {
            ...lastPart,
            text: lastPart.text + delta,
          };
        } else {
          parts.push({ type: 'text', text: delta, state: 'streaming' });
        }

        return { ...msg, parts, content: msg.content + delta };
      }),
    });
  },

  addReasoningPart: (id) => {
    const state = get();
    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg;
        return {
          ...msg,
          parts: [...msg.parts, { type: 'reasoning', text: '', state: 'streaming' as const }],
        };
      }),
    });
  },

  appendReasoningDelta: (delta) => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;

        const parts = [...msg.parts];
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart.type === 'reasoning' && lastPart.state === 'streaming') {
          parts[parts.length - 1] = {
            ...lastPart,
            text: lastPart.text + delta,
          };
        }

        return { ...msg, parts };
      }),
    });
  },

  addToolPart: (toolInvocation) => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;
        return {
          ...msg,
          parts: [...msg.parts, { type: 'tool', tool: toolInvocation }],
        };
      }),
    });
  },

  updateToolInput: (toolCallId, input, state) => {
    const s = get();
    if (!s.currentAssistantId) return;

    set({
      messages: s.messages.map((msg) => {
        if (msg.id !== s.currentAssistantId) return msg;

        const parts = msg.parts.map((part) => {
          if (part.type === 'tool' && part.tool.toolCallId === toolCallId) {
            return {
              ...part,
              tool: { ...part.tool, input, state: state || part.tool.state },
            };
          }
          return part;
        });

        return { ...msg, parts };
      }),
    });
  },

  updateToolOutput: (toolCallId, output) => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;

        const parts = msg.parts.map((part) => {
          if (part.type === 'tool' && part.tool.toolCallId === toolCallId) {
            return {
              ...part,
              tool: { ...part.tool, output, state: 'output-available' as const },
            };
          }
          return part;
        });

        return { ...msg, parts };
      }),
    });
  },

  updateToolError: (toolCallId, errorText) => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;

        const parts = msg.parts.map((part) => {
          if (part.type === 'tool' && part.tool.toolCallId === toolCallId) {
            return {
              ...part,
              tool: { ...part.tool, errorText, state: 'output-error' as const },
            };
          }
          return part;
        });

        return { ...msg, parts };
      }),
    });
  },

  finalizeCurrentMessage: () => {
    const state = get();
    if (!state.currentAssistantId) return;

    set({
      currentAssistantId: null,
      messages: state.messages.map((msg) => {
        if (msg.id !== state.currentAssistantId) return msg;

        const parts = msg.parts.map((part) => {
          if (part.type === 'text') return { ...part, state: 'done' as const };
          if (part.type === 'reasoning') return { ...part, state: 'done' as const };
          return part;
        });

        return { ...msg, parts };
      }),
    });
  },

  setError: (error) => set({ error, status: 'error' }),

  reset: () => set({ status: 'idle', error: null, messages: [], currentAssistantId: null }),
}));
