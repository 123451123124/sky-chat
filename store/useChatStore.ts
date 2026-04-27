import { create } from 'zustand';

export type ChatStatus = 'idle' | 'thinking' | 'tool_calling' | 'answering' | 'error';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatState {
  status: ChatStatus;
  messages: Message[];
  error: string | null;
  setStatus: (status: ChatStatus) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateAssistantMessage: (content: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  status: 'idle',
  messages: [],
  error: null,

  setStatus: (status) => set({ status }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),

  updateAssistantMessage: (content) => {
    const state = get();
    // 从后往前找最后一个 assistant 消息
    let lastAssistantIndex = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) return;

    // 只有内容真的变了才更新
    const targetMsg = state.messages[lastAssistantIndex];
    if (targetMsg.content === content) return;

    set({
      messages: state.messages.map((msg, i) =>
        i === lastAssistantIndex ? { ...msg, content } : msg
      )
    });
  },

  setError: (error) => set({ error, status: 'error' }),

  reset: () => set({ status: 'idle', error: null }),
}));