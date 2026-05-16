"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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

interface SidebarProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession?: (id: string) => void;
  user: UserInfo;
  onLogout: () => void;
}

export function Sidebar({ currentSessionId, onSelectSession, onNewSession, onDeleteSession, user, onLogout }: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const fetchSessions = () => {
    fetch("/api/session")
      .then((res) => res.json())
      .then(setSessions);
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      fetchSessions();
    }
  }, [currentSessionId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定删除此会话？')) return;

    await fetch(`/api/session/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      onDeleteSession?.(id);
    }
  };

  return (
    <aside className="w-72 flex flex-col h-full bg-gray-100 dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-800">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewSession}
          className="w-full px-3 py-2.5 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg transition-colors text-sm flex items-center gap-2 border border-gray-200 dark:border-gray-700/50 shadow-sm dark:shadow-none"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建对话
        </button>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
        {sessions.length === 0 && (
          <div className="p-3 text-center text-gray-400 dark:text-gray-500 text-xs">暂无会话</div>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors text-sm mb-0.5 ${
              session.id === currentSessionId
                ? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="truncate">{session.title}</span>
            </div>
            <button
              onClick={(e) => handleDelete(e, session.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-all rounded hover:bg-gray-200 dark:hover:bg-gray-700/50 flex-shrink-0"
              title="删除会话"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14m-9 3v8m4-8v8M10 7h4m-6 0l.586-.586a2 2 0 012.828 0L12 7m-2 0h4" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-medium flex-shrink-0">
            {user.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{user.email}</div>
          </div>
          <div className="flex items-center gap-0.5">
            {user.role === 'admin' && (
              <Link
                href="/admin"
                className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                title="管理后台"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                </svg>
              </Link>
            )}
            <button
              onClick={onLogout}
              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              title="退出登录"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
