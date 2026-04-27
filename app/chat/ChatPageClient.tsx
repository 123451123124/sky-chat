"use client";

import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatContainer } from "./ChatContainer";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

interface ChatPageClientProps {
  initialSessions: Session[];
}

export function ChatPageClient({ initialSessions }: ChatPageClientProps) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);

  const handleNewSession = async () => {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新对话" }),
    });
    const newSession = await res.json();
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newSession.id);
  };

  const handleSelectSession = (id: string) => {
    setCurrentSessionId(id);
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
      />
      <main className="flex-1">
        {currentSessionId ? (
          <ChatContainer sessionId={currentSessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            选择或创建一个会话开始聊天
          </div>
        )}
      </main>
    </div>
  );
}