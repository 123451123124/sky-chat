"use client";

import { useRouter } from "next/navigation";

import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatContainer } from "./ChatContainer";
import { useChatStore } from "@/store/useChatStore";
import type { ChatSession, ChatUser } from "@/lib/chat-types";

export function ChatPageClient({ initialSessions, user, preview = false }: { initialSessions: ChatSession[]; user: ChatUser; preview?: boolean }) {
  const router = useRouter();
  const [currentSessionId, setCurrentSessionId] = useState("temp_initial");
  // Keep the container mounted when its temporary session is first persisted.
  const [chatKey, setChatKey] = useState("temp_initial");
  const [sessions, setSessions] = useState(initialSessions);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const reset = useChatStore((state) => state.reset);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (sidebarOpen) drawer?.showModal();
    else drawer?.close();
  }, [sidebarOpen]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (media.matches) setSidebarOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  const handleNewSession = useCallback(() => {
    const id = `temp_${crypto.randomUUID()}`;
    reset();
    setCurrentSessionId(id);
    setChatKey(id);
    setSidebarOpen(false);
  }, [reset]);

  const handleSelectSession = useCallback((id: string) => {
    if (id !== currentSessionId) {
      reset();
      setCurrentSessionId(id);
      setChatKey(id);
    }
    setSidebarOpen(false);
  }, [currentSessionId, reset]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const response = await fetch(`/api/session/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("删除失败");
    setSessions((previous) => previous.filter((session) => session.id !== id));
    if (id === currentSessionId) handleNewSession();
  }, [currentSessionId, handleNewSession]);

  const handleSessionCreated = useCallback((session: ChatSession) => {
    setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
    setCurrentSessionId(session.id);
  }, []);

  const handleSessionUpdated = useCallback((id: string, count: number) => {
    const updatedAt = new Date().toISOString();
    setSessions((previous) => previous.map((session) => session.id === id ? { ...session, updatedAt, _count: { messages: count } } : session).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  const handleLogout = async () => {
    if (preview) { router.replace("/login"); router.refresh(); return; }
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出失败");
      reset();
      router.replace("/login"); router.refresh();
    } catch { setLogoutError(true); }
  };

  const sidebarProps = { sessions, currentSessionId, onSelectSession: handleSelectSession, onNewSession: handleNewSession, onDeleteSession: handleDeleteSession, user, onLogout: handleLogout };

  return (
    <div className="sky-workspace">
      <div className="hidden h-full md:block"><Sidebar {...sidebarProps} /></div>
      <dialog ref={drawerRef} onClose={() => setSidebarOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setSidebarOpen(false); }} className="sky-drawer" aria-label="对话导航">
        <Sidebar {...sidebarProps} onClose={() => setSidebarOpen(false)} />
      </dialog>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {preview && <div className="sky-preview-banner">界面预览 · <a href="/login">登录后</a>即可连接模型、保存对话。</div>}
        {logoutError && <div role="alert" className="bg-red-50 px-4 py-2 text-center text-xs text-red-600">退出失败，请重试。<button onClick={() => setLogoutError(false)} className="ml-3 underline">关闭</button></div>}
        <ChatContainer key={chatKey} sessionId={currentSessionId} isNewSession={currentSessionId.startsWith("temp_")} onSessionCreated={handleSessionCreated} onSessionUpdated={handleSessionUpdated} onOpenSidebar={() => setSidebarOpen(true)} preview={preview} />
      </main>
    </div>
  );
}
