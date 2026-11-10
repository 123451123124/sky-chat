"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ArrowDownToLine, BookOpen, Check, ChevronDown, Globe2, History, LoaderCircle, Menu, MoreHorizontal, Share2, X } from "lucide-react";
import { KnowledgePanel } from './components/KnowledgePanel';
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useChatStore, type Message, type MessagePart } from "@/store/useChatStore";
import { SSEParser } from "@/lib/sse-parser";
import { parseAIStreamChunk, handleStreamChunk, type StreamCallbacks } from "@/lib/ai-stream";
import { StreamBuffer } from "@/lib/stream-buffer";
import { SSEPerformanceTracker, startAutoFlush } from "@/lib/monitor";
import { ALLOWED_MODELS, DEFAULT_MODEL, isValidModel } from "@/lib/models";
import type { ChatSession } from "@/lib/chat-types";

interface ChatContainerProps {
  sessionId: string;
  isNewSession?: boolean;
  onSessionCreated?: (session: ChatSession) => void;
  onSessionUpdated?: (id: string, count: number) => void;
  onOpenSidebar?: () => void;
  preview?: boolean;
}

const SUGGESTIONS = [
  { title: "润色文字", prompt: "帮我润色一段文字，让表达更清晰、自然。请先问我文字内容和使用场景。" },
  { title: "排查代码", prompt: "我遇到了一个编程问题，请帮我逐步排查。先问我使用的语言、预期结果和当前问题。" },
  { title: "解释概念", prompt: "我想学习一个新概念。请先问我想了解的主题，再用通俗的语言和例子解释。" },
];

type SavedMessage = { id: string; role: string; content: string; parts?: MessagePart[] | null };
function restoreMessages(data: SavedMessage[]): Message[] {
  return data.map((message) => ({ id: message.id, role: message.role as Message["role"], content: message.content, parts: message.parts?.length ? message.parts : message.role === "assistant" ? [{ type: "text", text: message.content, state: "done" }] : [] }));
}

export function ChatContainer({ sessionId, isNewSession, onSessionCreated, onSessionUpdated, onOpenSidebar, preview = false }: ChatContainerProps) {
  const { status, messages, error } = useChatStore();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedRef = useRef<string[]>([]);
  const [scopeState, setScopeState] = useState<'loading' | 'ready' | 'error'>(isNewSession ? 'ready' : 'loading');
  const [menu, setMenu] = useState<"model" | "history" | "actions" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">(isNewSession ? "ready" : "loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<StreamBuffer | null>(null);
  const persistedSessionId = useRef<string | null>(null);
  const persistedIds = useRef(new Map<string, string>());
  const replacementId = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const sending = useRef(false);
  const busy = status === "thinking" || status === "answering" || status === "tool_calling";

  useEffect(() => {
    mounted.current = true;
    const flush = startAutoFlush();
    // Synchronize browser preferences after hydration; storage may be unavailable.
    const timer = window.setTimeout(() => {
      try {
        const savedModel = localStorage.getItem("sky-chat-model");
        if (savedModel && isValidModel(savedModel)) setModel(savedModel);
        setSearchEnabled(localStorage.getItem("sky-chat-search") === "true");
      } catch { /* Defaults remain usable in private/restricted browsers. */ }
    }, 0);
    return () => { mounted.current = false; clearTimeout(timer); flush.stop(); abortRef.current?.abort(); bufferRef.current?.destroy(); };
  }, []);

  useEffect(() => {
    if (isNewSession || persistedSessionId.current === sessionId) return;
    const controller = new AbortController();
    fetch(`/api/message?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("加载失败");
        const data: SavedMessage[] = await response.json();
        if (!Array.isArray(data)) throw new Error("消息格式错误");
        if (!controller.signal.aborted) {
          useChatStore.getState().setMessages(restoreMessages(data));
          setHistoryState("ready");
        }
      }).catch(() => { if (!controller.signal.aborted) setHistoryState("error"); });
    return () => controller.abort();
  }, [sessionId, isNewSession, loadAttempt]);

  useEffect(() => {
    if (isNewSession || persistedSessionId.current === sessionId) return;
    const controller = new AbortController();
    fetch(`/api/knowledge?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error('资料范围加载失败');
      if (!controller.signal.aborted) {
        const ids = Array.isArray(data.selectedIds) ? data.selectedIds : [];
        selectedRef.current = ids; setSelectedIds(ids); setScopeState('ready');
      }
    }).catch(() => { if (!controller.signal.aborted) setScopeState('error'); });
    return () => controller.abort();
  }, [sessionId, isNewSession, loadAttempt]);

  const selectDocuments = useCallback(async (ids: string[]) => {
    if (preview) throw new Error('请登录后使用资料库');
    const sid = persistedSessionId.current || (!isNewSession ? sessionId : null);
    if (sid) {
      const response = await fetch(`/api/session/${sid}/documents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: ids }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '资料范围保存失败');
    }
    selectedRef.current = ids; setSelectedIds(ids);
  }, [isNewSession, sessionId, preview]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!menu) return;
    const clickOutside = (event: MouseEvent) => { if (!toolbarRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", clickOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", clickOutside); document.removeEventListener("keydown", escape); };
  }, [menu]);

  const saveMessage = useCallback(async (sid: string, message: Message, signal?: AbortSignal, replaceMessageId?: string) => {
    const response = await fetch("/api/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, role: message.role, content: message.content, parts: message.parts.filter((part) => part.type !== "step-start"), replaceMessageId }), signal });
    if (!response.ok) throw new Error("消息保存失败，请稍后重试");
    const saved: { id: string } = await response.json();
    persistedIds.current.set(message.id, saved.id);
  }, []);

  const createSession = useCallback(async (history: Message[], signal?: AbortSignal) => {
    const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: history[0]?.content.slice(0, 50) || "新对话", messages: history.map(({ role, content, parts }) => ({ role, content, parts })), documentIds: selectedRef.current }), signal });
    if (!response.ok) throw new Error("对话保存失败，请稍后重试");
    return await response.json() as ChatSession & { messages: SavedMessage[] };
  }, []);

  const runStream = useCallback(async (apiMessages: { role: string; content: string }[], sid: string, assistantId: string, controller: AbortController, replaceMessageId?: string) => {
    const tracker = new SSEPerformanceTracker({ sessionId: sid });
    tracker.start();
    const buffer = new StreamBuffer();
    bufferRef.current = buffer;
    buffer.onFlush((delta) => { if (mounted.current) useChatStore.getState().appendTextToMessage(assistantId, delta); });
    const toolInputs = new Map<string, string>();
    let finished = false;
    let failure: string | null = null;
    const state = useChatStore.getState;
    const callbacks: StreamCallbacks = {
      onRagTrace: (trace) => { buffer.forceFlush(); state().updateRagTrace(assistantId, trace); },
      onTextReplace: (text) => { buffer.forceFlush(); state().replaceAssistantText(assistantId, text); },
      onTextStart: () => { state().setStatus("answering"); tracker.onPhaseChange("answering"); },
      onTextDelta: (_id, delta) => { buffer.push(delta); tracker.onChunk(); },
      onTextEnd: () => buffer.forceFlush(),
      onReasoningStart: () => state().addReasoningPart(assistantId),
      onReasoningDelta: (_id, delta) => state().appendReasoningDelta(delta),
      onToolInputStart: (toolCallId, toolName) => { state().setStatus("tool_calling"); tracker.onPhaseChange("tool_calling"); state().addToolPart({ toolCallId, toolName, state: "input-streaming" }); toolInputs.set(toolCallId, ""); },
      onToolInputDelta: (id, delta) => { const input = (toolInputs.get(id) || "") + delta; toolInputs.set(id, input); state().updateToolInput(id, input, "input-streaming"); },
      onToolInputAvailable: (id, _name, input) => { toolInputs.delete(id); state().updateToolInput(id, input, "input-available"); },
      onToolOutputAvailable: (id, output) => { state().updateToolOutput(id, output); state().setStatus("answering"); },
      onToolOutputError: (id, text) => { state().updateToolError(id, text); state().setStatus("answering"); },
      onStepStart: () => buffer.forceFlush(),
      onFinish: () => { finished = true; },
      onError: (text) => { failure = text || "生成失败，请重试"; },
      onAbort: () => { controller.abort(); },
    };

    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, messages: apiMessages.slice(-40), model, searchEnabled }), signal: controller.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(response.status === 401 ? "登录已过期，请重新登录" : data?.error || `请求失败（${response.status}），请重试`);
      }
      if (!response.body) throw new Error("没有收到回复，请重试");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      try {
        while (!finished && !failure && !controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (!mounted.current || controller.signal.aborted) break;
          const events = parser.parse(done ? decoder.decode() : decoder.decode(value, { stream: true }));
          for (const event of events) {
            const chunk = parseAIStreamChunk(event.data);
            if (chunk) handleStreamChunk(chunk, callbacks);
            if (finished || failure || controller.signal.aborted) break;
          }
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!finished && !failure && !controller.signal.aborted) failure = "连接中断，已保留收到的内容。你可以重试。";
    } catch (cause) {
      if (!controller.signal.aborted) failure = cause instanceof Error ? cause.message : "网络连接失败，请重试";
    } finally {
      if (mounted.current) {
        buffer.forceFlush();
        state().finalizeCurrentMessage();
        const trace = state().messages.find((item) => item.id === assistantId)?.parts.find((part) => part.type === 'rag');
        if (trace?.type === 'rag' && trace.trace.status === 'running') state().updateRagTrace(assistantId, { ...trace.trace, status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? '已停止生成' : '连接中断，执行记录可能不完整' });
        const message = state().messages.find((item) => item.id === assistantId);
        if (message && !message.content && !message.parts.length) {
          state().setMessages(state().messages.filter((item) => item.id !== assistantId));
        }
        if (message && (message.content || message.parts.length)) {
          try {
            // A user-requested stop still saves the partial answer.
            await saveMessage(sid, message, undefined, replaceMessageId);
            replacementId.current = undefined;
            if (mounted.current) onSessionUpdated?.(sid, state().messages.length);
          } catch { if (mounted.current) setToast("回复已保留在当前页面，但保存失败，请复制备份。"); }
        }
        if (mounted.current) {
          if (failure) state().setError(failure);
          else state().setStatus("idle");
        }
      }
      buffer.destroy();
      if (bufferRef.current === buffer) bufferRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
      sending.current = false;
      void tracker.finish();
    }
  }, [model, searchEnabled, saveMessage, onSessionUpdated]);

  const handleSend = useCallback(async (text: string) => {
    if (preview) throw new Error("这是界面预览，请登录后开始真实对话。");
    if (sending.current || historyState !== "ready") throw new Error("请等待当前操作完成");
    if (scopeState !== 'ready') throw new Error('资料范围尚未加载，请重试加载，避免遗漏已选资料');
    const ids = [...selectedRef.current];
    if (ids.length > 12) throw new Error('最多同时选择 12 个文件，请先移除部分资料');
    sending.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const previous = useChatStore.getState().messages;
    const userMessage: Message = { id: `local_${crypto.randomUUID()}`, role: "user", content: text, parts: [] };
    const state = useChatStore.getState;
    state().setError(null);
    state().addMessage(userMessage);
    state().setStatus("thinking");
    try {
      await selectDocuments(ids);
      let sid = persistedSessionId.current || (!isNewSession ? sessionId : null);
      if (!sid) {
        const session = await createSession([...previous.filter((message) => message.content || message.parts.length), userMessage], controller.signal);
        sid = session.id;
        persistedSessionId.current = sid;
        if (mounted.current && !controller.signal.aborted) onSessionCreated?.(session);
      } else { await saveMessage(sid, userMessage, controller.signal); }
      if (!mounted.current || controller.signal.aborted) {
        sending.current = false;
        if (mounted.current) state().setStatus("idle");
        return;
      }
      onSessionUpdated?.(sid, state().messages.length);
      const apiMessages = [...previous, userMessage].filter((message) => message.role === "user" || message.content).map(({ role, content }) => ({ role, content }));
      replacementId.current = undefined;
      const assistantId = `local_${crypto.randomUUID()}`;
      state().startAssistantMessage(assistantId);
      void runStream(apiMessages, sid, assistantId, controller);
    } catch (cause) {
      sending.current = false;
      if (mounted.current) {
        state().setMessages(previous);
        state().setStatus("idle");
      }
      if (!controller.signal.aborted) throw cause;
    }
  }, [historyState, scopeState, isNewSession, sessionId, createSession, saveMessage, onSessionCreated, onSessionUpdated, runStream, preview, selectDocuments]);

  const handleRegenerate = useCallback(() => {
    if (sending.current || historyState !== "ready" || scopeState !== 'ready') return;
    const state = useChatStore.getState();
    const lastUser = state.messages.findLastIndex((message) => message.role === "user");
    const sid = persistedSessionId.current || (!isNewSession ? sessionId : null);
    if (lastUser < 0 || !sid) return;
    const oldAnswer = state.messages[lastUser + 1];
    if (oldAnswer) replacementId.current = persistedIds.current.get(oldAnswer.id) || (!oldAnswer.id.startsWith("local_") ? oldAnswer.id : replacementId.current);
    const history = state.messages.slice(0, lastUser + 1);
    state.setMessages(history);
    state.setError(null);
    state.setStatus("thinking");
    const assistantId = `local_${crypto.randomUUID()}`;
    state.startAssistantMessage(assistantId);
    const controller = new AbortController();
    abortRef.current = controller;
    sending.current = true;
    void runStream(history.filter((message) => message.content).map(({ role, content }) => ({ role, content })), sid, assistantId, controller, replacementId.current);
  }, [historyState, scopeState, isNewSession, sessionId, runStream]);

  const handleBranch = async (index: number) => {
    if (sending.current) return;
    sending.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    useChatStore.getState().setStatus("thinking");
    try {
      const session = await createSession(useChatStore.getState().messages.slice(0, index + 1), controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      persistedSessionId.current = session.id;
      persistedIds.current.clear();
      replacementId.current = undefined;
      useChatStore.getState().setMessages(restoreMessages(session.messages));
      onSessionCreated?.(session);
      setToast("已创建分支对话，可以从这里继续。");
    } catch { if (mounted.current && !controller.signal.aborted) setToast("创建分支失败，请重试。"); }
    finally { sending.current = false; if (mounted.current) useChatStore.getState().setStatus("idle"); }
  };

  const handleShare = async () => {
    const sid = persistedSessionId.current || (!isNewSession ? sessionId : null);
    if (!sid || busy) { setToast("请等待对话保存完成后再分享。"); return; }
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid }) });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error();
      await navigator.clipboard.writeText(new URL(data.url, window.location.origin).href);
      setToast("分享链接已复制。");
    } catch { setToast("分享失败，请重试并允许剪贴板访问。"); }
  };

  const handleExport = () => {
    const content = `# Sky Chat\n\n${messages.filter((message) => message.content).map((message) => `## ${message.role === "user" ? "你" : "Sky Chat"}\n\n${message.content}`).join("\n\n---\n\n")}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `SkyChat-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const searches = messages.flatMap((message) => message.parts.flatMap((part) => part.type === "tool" && part.tool.toolName === "webSearch" && part.tool.state === "output-available" ? [part.tool] : []));
  const welcome = messages.length === 0 && historyState === "ready";

  return (
    <div className="sky-chat">
      <header className="sky-toolbar" ref={toolbarRef}>
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={onOpenSidebar} className="sky-icon-button sky-mobile-menu" aria-label="打开侧栏"><Menu size={20} /></button>
          <div className="relative">
            <button onClick={() => setMenu(menu === "model" ? null : "model")} className="sky-model-button" aria-expanded={menu === "model"} aria-controls="model-picker"><span className="size-1.5 rounded-full bg-teal-600" /><span className="sky-model-label">{ALLOWED_MODELS.find((item) => item.id === model)?.name || model}</span><ChevronDown size={14} /></button>
            {menu === "model" && <div id="model-picker" className="sky-popover left-0 min-w-52" aria-label="选择模型">{ALLOWED_MODELS.map((item) => <button key={item.id} aria-pressed={item.id === model} onClick={() => { setModel(item.id); setMenu(null); try { localStorage.setItem("sky-chat-model", item.id); } catch {} }} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs hover:bg-teal-50 dark:hover:bg-teal-900/30">{item.name}{item.id === model && <Check size={15} className="text-teal-600" />}</button>)}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button className="sky-knowledge-toggle" disabled={busy} onClick={() => preview ? setToast('请登录后使用文件与知识库。') : setKnowledgeOpen(true)} aria-label="文件与知识库"><BookOpen size={17} /><span className="hidden sm:inline">资料</span>{selectedIds.length > 0 && <span className="sky-scope-count">{selectedIds.length}</span>}</button>
          <button onClick={() => { const enabled = !searchEnabled; setSearchEnabled(enabled); try { localStorage.setItem("sky-chat-search", String(enabled)); } catch {} }} aria-pressed={searchEnabled} className={`sky-search-toggle ${searchEnabled ? "is-active" : ""}`} title="联网搜索"><Globe2 size={15} /><span className="hidden sm:inline">联网搜索</span><span className="sky-switch" /></button>
          <span className="mx-1 h-4 border-l border-black/10 dark:border-white/10" />
          {searches.length > 0 && <div className="relative"><button className="sky-icon-button" onClick={() => setMenu(menu === "history" ? null : "history")} aria-label="搜索记录" aria-expanded={menu === "history"}><History size={17} /></button>{menu === "history" && <div className="sky-popover right-0 max-h-72 w-64 overflow-y-auto"><p className="p-2 text-xs text-gray-400">本次搜索记录</p>{searches.map((tool) => <p key={tool.toolCallId} className="break-words border-t border-gray-100 px-2 py-3 text-xs dark:border-gray-800">{(tool.input as { query?: string })?.query || "搜索"}</p>)}</div>}</div>}
          {messages.length > 0 && <>
            <button onClick={handleExport} className="sky-icon-button sky-desktop-action" aria-label="导出对话" title="导出 Markdown"><ArrowDownToLine size={17} /></button>
            <button onClick={() => void handleShare()} disabled={busy} className="sky-icon-button sky-desktop-action" aria-label="分享对话" title="分享对话"><Share2 size={17} /></button>
            <div className="sky-overflow-actions relative">
              <button onClick={() => setMenu(menu === "actions" ? null : "actions")} className="sky-icon-button" aria-label="更多对话操作" aria-expanded={menu === "actions"} aria-controls="conversation-actions"><MoreHorizontal size={20} /></button>
              {menu === "actions" && <div id="conversation-actions" className="sky-popover right-0 w-48" aria-label="对话操作">
                <button onClick={() => { setMenu(null); handleExport(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2" aria-label="导出对话"><ArrowDownToLine size={17} />导出对话</button>
                <button onClick={() => { setMenu(null); void handleShare(); }} disabled={busy} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 disabled:opacity-50" aria-label="分享对话"><Share2 size={17} />分享对话</button>
              </div>}
            </div>
          </>}
          <ThemeToggle />
        </div>
      </header>
      {selectedIds.length > 0 && <div className="sky-active-scope"><BookOpen size={14} /><span>正在使用 {selectedIds.length} 个文件回答</span><button disabled={busy} onClick={() => setKnowledgeOpen(true)}>查看范围</button><button disabled={busy} onClick={() => void selectDocuments([]).catch(() => setToast('资料范围保存失败，请重试。'))}>清空</button></div>}
      {scopeState === 'error' && <div role="alert" className="sky-active-scope">资料范围加载失败，发送已暂停。<button onClick={() => { setScopeState('loading'); setLoadAttempt((v) => v + 1); }}>重新加载</button></div>}
      <KnowledgePanel open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} selectedIds={selectedIds} onSelect={selectDocuments} disabled={busy} />
      {toast && <div role="status" className="sky-toast">{toast}<button onClick={() => setToast(null)} aria-label="关闭提示"><X size={14} /></button></div>}
      {historyState !== "ready" ? <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-gray-500">{historyState === "loading" ? <><LoaderCircle className="animate-spin text-teal-600" size={24} />正在找回这段对话…</> : <><p>暂时无法加载对话，请检查网络后重试。</p><button className="sky-model-button" onClick={() => { setHistoryState("loading"); setLoadAttempt((attempt) => attempt + 1); }}>重新加载</button></>}</div> : welcome ? (
        <div className="sky-welcome scrollbar-thin">
          <div className="sky-welcome-inner">
            <h1 className="sky-welcome-title">今天，想聊点什么？</h1>
            <p className="sky-welcome-description">写作、编程，或一个突然冒出的疑问。</p>
            <ChatInput value={draft} onChange={setDraft} onSend={handleSend} busy={busy} disabled={scopeState !== 'ready'} onStop={() => abortRef.current?.abort()} centered />
            <div className="sky-quick-prompts" aria-label="快捷提问">{SUGGESTIONS.map(({ title, prompt }) => <button key={title} aria-pressed={draft === prompt} onClick={() => { setDraft(prompt); document.querySelector<HTMLTextAreaElement>("textarea[aria-label='输入消息']")?.focus(); }} className="sky-quick-prompt">{title}</button>)}</div>
          </div>
          <p className="sky-welcome-footer">AI 生成的内容可能有误，请核实重要信息。</p>
        </div>
      ) : (
        <>
          <MessageList messages={messages} onRegenerate={handleRegenerate} canRegenerate={!busy && scopeState === 'ready'} onBranch={busy ? undefined : (index) => void handleBranch(index)} />
          <div role="status" aria-live="polite" className="mx-auto w-full max-w-3xl px-6 text-[11px] text-gray-400">{busy && <span className="inline-flex items-center gap-2 py-2"><span className="size-1.5 animate-pulse rounded-full bg-teal-500" />{status === "thinking" ? "正在思考…" : status === "tool_calling" ? "正在使用工具…" : "正在回复…"}</span>}</div>
          {error && <div role="alert" className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 py-3 text-xs text-red-600 dark:text-red-400"><span>{error}</span><button onClick={handleRegenerate} className="shrink-0 underline">重试</button></div>}
          <ChatInput value={draft} onChange={setDraft} onSend={handleSend} busy={busy} disabled={historyState !== "ready" || scopeState !== 'ready'} onStop={() => abortRef.current?.abort()} />
        </>
      )}
    </div>
  );
}
