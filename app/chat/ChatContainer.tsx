"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ChatInput } from "./components/ChatInput";
import type { FileAttachment } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { ThinkingIndicator } from "./components/ThinkingIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useChatStore } from '@/store/useChatStore';
import { SSEParser } from "@/lib/sse-parser";
import { parseAIStreamChunk, handleStreamChunk, type StreamCallbacks } from "@/lib/ai-stream";
import { StreamBuffer } from "@/lib/stream-buffer";
import { SSEPerformanceTracker, startAutoFlush } from "@/lib/monitor";
import type { Message, MessagePart } from "@/store/useChatStore";

interface SessionData {
  id: string;
  title: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface ChatContainerProps {
  sessionId: string;
  isNewSession?: boolean;
  onSessionCreated?: (session: SessionData) => void;
}

import { ALLOWED_MODELS, DEFAULT_MODEL } from "@/lib/models";

const STORAGE_KEY = 'sky-chat-model';
const SEARCH_STORAGE_KEY = 'sky-chat-search';

function getSavedModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL;
}

function getSavedSearchEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SEARCH_STORAGE_KEY) === 'true';
}

export function ChatContainer({ sessionId, isNewSession, onSessionCreated }: ChatContainerProps) {
  const status = useChatStore((s) => s.status);
  const messages = useChatStore((s) => s.messages);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage);
  const appendTextToMessage = useChatStore((s) => s.appendTextToMessage);
  const addReasoningPart = useChatStore((s) => s.addReasoningPart);
  const appendReasoningDelta = useChatStore((s) => s.appendReasoningDelta);
  const addToolPart = useChatStore((s) => s.addToolPart);
  const updateToolInput = useChatStore((s) => s.updateToolInput);
  const updateToolOutput = useChatStore((s) => s.updateToolOutput);
  const updateToolError = useChatStore((s) => s.updateToolError);
  const finalizeCurrentMessage = useChatStore((s) => s.finalizeCurrentMessage);
  const reset = useChatStore((s) => s.reset);

  const bufferRef = useRef<StreamBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sseTrackerRef = useRef<SSEPerformanceTracker | null>(null);
  const toolInputBufRef = useRef<Map<string, string>>(new Map());
  const [shareToast, setShareToast] = useState<string | null>(null);
  const persistedSessionId = useRef<string | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const searchHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setModel(getSavedModel());
    setSearchEnabled(getSavedSearchEnabled());
  }, []);

  useEffect(() => {
    const flush = startAutoFlush();
    return () => {
      flush.stop();
      bufferRef.current?.destroy();
      abortControllerRef.current?.abort();
    };
  }, []);

  // Load messages for persisted sessions
  useEffect(() => {
    if (!sessionId || isNewSession) return;
    // Store already has messages from streaming (temp→real transition), skip re-fetch
    if (messages.length > 0) return;
    fetch(`/api/message?sessionId=${sessionId}`)
      .then((res) => res.json())
      .then((data: Array<{ id: string; role: string; content: string; parts?: MessagePart[] | null }>) => {
        const msgs: Message[] = data.map((m) => {
          // Use persisted parts if available, otherwise recreate from content (backwards compat)
          if (m.parts && m.parts.length > 0) {
            return {
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              parts: m.parts as MessagePart[],
            };
          }
          return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            parts: m.role === 'assistant'
              ? [{ type: 'text' as const, text: m.content, state: 'done' as const }]
              : [],
          };
        });
        setMessages(msgs);
      });
  }, [sessionId, isNewSession, setMessages, messages.length]);

  // Reset ref when switching sessions
  useEffect(() => {
    persistedSessionId.current = null;
  }, [sessionId]);

  // Close model picker / search history on outside click
  useEffect(() => {
    if (!showModelPicker && !showSearchHistory) return;
    const handler = (e: MouseEvent) => {
      if (showModelPicker && modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
      if (showSearchHistory && searchHistoryRef.current && !searchHistoryRef.current.contains(e.target as Node)) {
        setShowSearchHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelPicker, showSearchHistory]);

  const handleModelChange = useCallback((newModel: string) => {
    setModel(newModel);
    localStorage.setItem(STORAGE_KEY, newModel);
    setShowModelPicker(false);
  }, []);

  const handleSearchToggle = useCallback(() => {
    setSearchEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(SEARCH_STORAGE_KEY, next.toString());
      return next;
    });
  }, []);

  const saveMessage = useCallback(async (sid: string, role: "user" | "assistant", content: string, parts?: MessagePart[]) => {
    await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role, content, parts }),
    });
  }, []);

  const createSessionAndSave = useCallback(async (msgs: { role: string; content: string; parts?: MessagePart[] }[]) => {
    const title = msgs[0]?.content?.slice(0, 50) || "新对话";
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, messages: msgs }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Session create failed: ${res.status}`);
    }
    return await res.json();
  }, []);

  const streamRequest = useCallback(async (
    apiMessages: { role: string; content: string }[],
    assistantId: string,
    firstUserContent: string,
    currentModel: string,
    searchEnabled: boolean,
  ) => {
    const effectiveSessionId = persistedSessionId.current || sessionId;
    const tracker = new SSEPerformanceTracker({ sessionId: effectiveSessionId });
    tracker.start();
    sseTrackerRef.current = tracker;

    const buffer = new StreamBuffer();
    bufferRef.current = buffer;

    buffer.onFlush((combinedDelta) => {
      // 直接按消息 ID 追加，不依赖 currentAssistantId
      appendTextToMessage(assistantId, combinedDelta);
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const callbacks: StreamCallbacks = {
      onTextStart: () => {
        setStatus('answering');
        tracker.onPhaseChange('answering');
      },
      onTextDelta: (_id, delta) => {
        buffer.push(delta);
        tracker.onChunk();
      },
      onTextEnd: () => { buffer.forceFlush(); },
      onReasoningStart: () => { addReasoningPart(assistantId); },
      onReasoningDelta: (_id, delta) => { appendReasoningDelta(delta); },
      onReasoningEnd: () => {},
      onToolInputStart: (toolCallId, toolName) => {
        setStatus('tool_calling');
        tracker.onPhaseChange('tool_calling');
        addToolPart({ toolCallId, toolName, state: 'input-streaming' });
        toolInputBufRef.current.set(toolCallId, '');
      },
      onToolInputDelta: (toolCallId, delta) => {
        const buf = toolInputBufRef.current;
        const acc = (buf.get(toolCallId) || '') + delta;
        buf.set(toolCallId, acc);
        updateToolInput(toolCallId, acc, 'input-streaming');
      },
      onToolInputAvailable: (toolCallId, toolName, input) => {
        toolInputBufRef.current.delete(toolCallId);
        updateToolInput(toolCallId, input, 'input-available');
      },
      onToolOutputAvailable: (toolCallId, output) => {
        updateToolOutput(toolCallId, output);
        setStatus('answering');
      },
      onToolOutputError: (toolCallId, errorText) => {
        updateToolError(toolCallId, errorText);
        setStatus('answering');
      },
      onStepStart: () => {
        // 确保当前消息的状态正确，为下一步文本做准备
        // 不创建新消息，所有文本合并到同一条消息
        buffer.forceFlush();
      },
      onFinish: async () => {
        buffer.forceFlush();
        finalizeCurrentMessage();
        setStatus('idle');

        const state = useChatStore.getState();
        const assistantMsg = state.messages.find((m) => m.id === assistantId);
        if (!assistantMsg) { tracker.finish(); return; }

        const persistableParts = assistantMsg.parts.filter(p => p.type !== 'step-start');

        if (isNewSession && !persistedSessionId.current) {
          try {
            const session = await createSessionAndSave([
              { role: 'user', content: firstUserContent },
              { role: 'assistant', content: assistantMsg.content, parts: persistableParts },
            ]);
            persistedSessionId.current = session.id;
            onSessionCreated?.({
              id: session.id,
              title: session.title,
              updatedAt: new Date().toISOString(),
              _count: { messages: 2 },
            });
          } catch (e) {
            console.error('Failed to create session:', e);
          }
        } else {
          const sid = persistedSessionId.current || sessionId;
          await saveMessage(sid, "assistant", assistantMsg.content, persistableParts);
        }
        tracker.finish();
        sseTrackerRef.current = null;
      },
      onError: (errorText) => {
        buffer.forceFlush();
        finalizeCurrentMessage();
        setError(errorText);
      },
      onAbort: () => {
        buffer.forceFlush();
        finalizeCurrentMessage();
        reset();
      },
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: currentModel,
          searchEnabled,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const sseParser = new SSEParser();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const events = sseParser.parse(chunk);
          for (const event of events) {
            const streamChunk = parseAIStreamChunk(event.data);
            if (streamChunk) handleStreamChunk(streamChunk, callbacks);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error("Stream error:", error);
      buffer.forceFlush();
      finalizeCurrentMessage();
      setError('网络错误，请重试');
    } finally {
      buffer.destroy();
      bufferRef.current = null;
      abortControllerRef.current = null;
    }
  }, [
    sessionId, isNewSession, onSessionCreated, searchEnabled,
    setStatus, setError, startAssistantMessage,
    appendTextToMessage, addReasoningPart, appendReasoningDelta, addToolPart,
    updateToolInput, updateToolOutput, updateToolError, finalizeCurrentMessage, reset,
    saveMessage, createSessionAndSave,
  ]);

  const handleSend = useCallback(async (text: string, file?: FileAttachment) => {
    const effectiveId = persistedSessionId.current || sessionId;
    const displayContent = text || `[文件: ${file?.fileName || 'unknown'}]`;

    let apiUserContent = text;
    if (file) {
      apiUserContent = `【用户上传了文件: ${file.fileName}】\n文件内容:\n${file.textContent.slice(0, 50000)}\n\n用户问题: ${text || '请分析这个文件'}`;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: displayContent,
      parts: [],
    };

    if (!isNewSession || persistedSessionId.current) {
      // Save after adding to store so user sees message immediately
      addMessage(userMessage);
      setStatus('thinking');
      await saveMessage(effectiveId, "user", userMessage.content);
    } else {
      addMessage(userMessage);
      setStatus('thinking');
    }

    const assistantId = (Date.now() + 1).toString();
    startAssistantMessage(assistantId);

    // Build API messages from the current store, override last user message with full context
    const state = useChatStore.getState();
    const allMessages = state.messages;
    const apiMessages = allMessages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    if (apiMessages.length > 0) {
      apiMessages[apiMessages.length - 1].content = apiUserContent;
    } else {
      apiMessages.push({ role: 'user', content: apiUserContent });
    }

    await streamRequest(apiMessages, assistantId, apiUserContent, model, searchEnabled);
  }, [
    isNewSession, sessionId, addMessage, saveMessage,
    setStatus, startAssistantMessage, streamRequest, model, searchEnabled,
  ]);

  const handleRegenerate = useCallback(async () => {
    const state = useChatStore.getState();
    const msgs = state.messages;
    const lastUserIdx = msgs.length - 2;
    if (lastUserIdx < 0 || msgs[lastUserIdx]?.role !== 'user') return;

    const msgsWithoutLast = msgs.slice(0, -1);
    setMessages(msgsWithoutLast);
    setStatus('thinking');

    const assistantId = (Date.now() + 1).toString();
    startAssistantMessage(assistantId);

    const apiMessages = msgsWithoutLast
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    await streamRequest(apiMessages, assistantId, msgs[lastUserIdx]?.content || "", model, searchEnabled);
  }, [setMessages, setStatus, startAssistantMessage, streamRequest, model, searchEnabled]);

  const handleBranch = useCallback((messageIndex: number) => {
    const state = useChatStore.getState();
    const msgs = state.messages.slice(0, messageIndex + 1);
    setMessages(msgs);
    setStatus('idle');
    setError(null);
  }, [setMessages, setStatus, setError]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    bufferRef.current?.forceFlush();
    finalizeCurrentMessage();
    reset();
  }, [finalizeCurrentMessage, reset]);

  const handleShare = useCallback(async () => {
    const sid = persistedSessionId.current || sessionId;
    if (isNewSession && !persistedSessionId.current) {
      setShareToast('请等待消息发送完成后再分享');
      setTimeout(() => setShareToast(null), 3000);
      return;
    }
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = await res.json();
      if (data.url) {
        const fullUrl = `${window.location.origin}${data.url}`;
        await navigator.clipboard.writeText(fullUrl);
        setShareToast('分享链接已复制到剪贴板！');
        setTimeout(() => setShareToast(null), 3000);
      }
    } catch {
      setShareToast('分享失败，请重试');
      setTimeout(() => setShareToast(null), 3000);
    }
  }, [sessionId, isNewSession]);

  // --- Welcome state (centered input) ---
  if (isNewSession && messages.length === 0) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-gray-900 relative">
        {/* Top bar: model picker + actions */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <div className="relative" ref={modelPickerRef}>
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              {ALLOWED_MODELS.find(m => m.id === model)?.name || model}
            </button>
            {showModelPicker && (
              <div className="absolute top-full left-0 mt-1.5 w-48 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-gray-200/60 dark:border-gray-700/40 rounded-xl shadow-xl z-50 py-1.5">
                {ALLOWED_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleModelChange(m.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-all rounded-lg mx-0.5 ${
                      model === m.id
                        ? 'text-gray-900 dark:text-gray-100 bg-blue-50 dark:bg-blue-900/30 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                    style={{ width: 'calc(100% - 4px)' }}
                  >
                    <div className="flex items-center gap-2">
                      {model === m.id && (
                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span>{m.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSearchToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all ${
              searchEnabled
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200/40 dark:border-blue-700/30'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
            title={searchEnabled ? '搜索已开启' : '搜索已关闭'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <span>搜索</span>
          </button>
          <ThemeToggle />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4 relative">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-blue-50/30 via-transparent to-transparent dark:from-blue-950/10 dark:via-transparent pointer-events-none" />
          <div className="relative text-center mb-8 max-w-md">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20 mb-6">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2 bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
              Sky Chat
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              有什么可以帮助你的？
            </p>
          </div>
          <ChatInput onSend={handleSend} centered />
        </div>
      </div>
    );
  }

  // --- Normal chat state ---
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 relative">
      {shareToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-gray-900/90 dark:bg-gray-700/90 backdrop-blur-sm text-white text-sm rounded-xl shadow-xl animate-fade-in-up border border-gray-700/20 dark:border-gray-600/30">
          {shareToast}
        </div>
      )}

      {/* Top bar: model picker + actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="relative" ref={modelPickerRef}>
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            {ALLOWED_MODELS.find(m => m.id === model)?.name || model}
          </button>
          {showModelPicker && (
            <div className="absolute top-full left-0 mt-1.5 w-48 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-gray-200/60 dark:border-gray-700/40 rounded-xl shadow-xl z-50 py-1.5">
              {ALLOWED_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleModelChange(m.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-all rounded-lg mx-0.5 ${
                    model === m.id
                      ? 'text-gray-900 dark:text-gray-100 bg-blue-50 dark:bg-blue-900/30 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                  style={{ width: 'calc(100% - 4px)' }}
                >
                  <div className="flex items-center gap-2">
                    {model === m.id && (
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span>{m.name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleSearchToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all ${
              searchEnabled
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200/40 dark:border-blue-700/30'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
            title={searchEnabled ? '搜索已开启' : '搜索已关闭'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <span>搜索</span>
          </button>
          <ThemeToggle />
          {messages.length > 0 && (() => {
            const searches: Array<{ toolCallId: string; toolName: string; input?: unknown; output?: unknown; state: string }> = [];
            for (const m of messages) {
              if (m.role !== 'assistant') continue;
              for (const p of m.parts) {
                if (p.type === 'tool' && p.tool.toolName === 'webSearch' && p.tool.state === 'output-available') {
                  searches.push(p.tool);
                }
              }
            }
            if (searches.length === 0) return null;
            return (
              <div className="relative" ref={searchHistoryRef}>
                <button
                  onClick={() => setShowSearchHistory(!showSearchHistory)}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors relative"
                  title="搜索历史"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center">
                    {searches.length}
                  </span>
                </button>
                {showSearchHistory && (
                  <div className="absolute top-full right-0 mt-1.5 w-80 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-gray-200/60 dark:border-gray-700/40 rounded-xl shadow-xl z-50 py-1.5 max-h-80 overflow-y-auto scrollbar-thin">
                    <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100/60 dark:border-gray-700/40 font-medium">
                      本次搜索记录
                    </div>
                    {searches.map((tool, i) => (
                      <div key={i} className="px-4 py-2.5 hover:bg-gray-50/80 dark:hover:bg-gray-700/40 border-b border-gray-50/60 dark:border-gray-700/20 last:border-0 transition-colors">
                        <div className="text-xs text-gray-900 dark:text-gray-100 font-medium truncate">
                          {(tool.input as Record<string, string>)?.query || '搜索'}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                          {typeof tool.output === 'string'
                            ? tool.output.slice(0, 80) + (tool.output.length > 80 ? '...' : '')
                            : '已获取搜索结果'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {messages.length > 0 && (
            <button onClick={handleShare} className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="分享">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stop button */}
      {status !== 'idle' && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 animate-fade-in-up">
          <button
            onClick={handleStop}
            className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-red-200/60 dark:border-red-700/40 rounded-full shadow-lg shadow-red-500/5 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-600/50 transition-all flex items-center gap-2 active:scale-95"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            停止生成
          </button>
        </div>
      )}

      {/* Message list */}
      {messages.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <MessageList
          messages={messages}
          onRegenerate={handleRegenerate}
          canRegenerate={status === 'idle' && messages.length >= 2}
          onBranch={handleBranch}
        />
      )}
      <ThinkingIndicator />
      <ChatInput onSend={handleSend} disabled={status !== 'idle'} />
    </div>
  );
}
