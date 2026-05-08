"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatContainer } from "./ChatContainer";
import { useChatStore } from "@/store/useChatStore";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

interface UserInfo {
  userId: string;
  email: string;
  role: string;
}

interface ChatPageClientProps {
  initialSessions: Session[];
  user: UserInfo;
}

function isTempId(id: string) {
  return id.startsWith("temp_");
}

export function ChatPageClient({ initialSessions, user }: ChatPageClientProps) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const setMessages = useChatStore((s) => s.setMessages);
  const reset = useChatStore((s) => s.reset);

  const handleNewSession = useCallback(() => {
    // Create a temp session; ChatContainer shows welcome screen until first message
    const tempId = `temp_${Date.now()}`;
    setCurrentSessionId(tempId);
    setMessages([]);
    reset();
  }, [setMessages, reset]);

  const handleSelectSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    if (isTempId(id)) {
      setCurrentSessionId(null);
      setMessages([]);
      reset();
      return;
    }
    fetch(`/api/session/${id}`, { method: "DELETE" }).catch(() => {});
    setCurrentSessionId(null);
    setMessages([]);
    reset();
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, [setMessages, reset]);

  const handleSessionCreated = useCallback((newSession: { id: string; title: string; updatedAt: string; _count?: { messages: number } }) => {
    setSessions((prev) => [newSession as Session, ...prev]);
    setCurrentSessionId(newSession.id);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const isNewSession = currentSessionId ? isTempId(currentSessionId) : false;

  // If no session, create a temp one to enter welcome mode
  const effectiveSessionId = currentSessionId || `temp_${Date.now()}`;
  const isNew = !currentSessionId || isNewSession;

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      <Sidebar
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        user={user}
        onLogout={handleLogout}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatContainer
          key={effectiveSessionId}
          sessionId={effectiveSessionId}
          isNewSession={isNew}
          onSessionCreated={handleSessionCreated}
        />
      </main>
    </div>
  );
}
