"use client";

import { useState, useEffect } from "react";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

interface SidebarProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export function Sidebar({ currentSessionId, onSelectSession, onNewSession }: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    fetch("/api/session")
      .then((res) => res.json())
      .then(setSessions);
  }, []);

  return (
    <aside className="w-64 border-r flex flex-col h-full">
      <div className="p-4 border-b">
        <button
          onClick={onNewSession}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          新建对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={`w-full text-left px-4 py-3 border-b hover:bg-gray-100 ${
              session.id === currentSessionId ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
            }`}
          >
            <div className="font-medium truncate">{session.title}</div>
            <div className="text-xs text-gray-500">
              {session._count.messages} 条消息
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}