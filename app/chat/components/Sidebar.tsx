"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, MessageSquare, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { SkyMark } from "@/components/SkyMark";
import type { ChatSession, ChatUser } from "@/lib/chat-types";

interface SidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => Promise<void>;
  onClose?: () => void;
  user: ChatUser;
  onLogout: () => void;
}

export function Sidebar({ sessions, currentSessionId, onSelectSession, onNewSession, onDeleteSession, onClose, user, onLogout }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = sessions.filter((session) => session.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const handleDelete = async (id: string) => {
    if (!window.confirm("删除这段对话？删除后无法恢复。")) return;
    setDeleting(id);
    setError(null);
    try {
      await onDeleteSession(id);
    } catch {
      setError("删除失败，请重试。你的对话仍然保留。");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <aside className="sky-sidebar" aria-label="对话导航">
      <div className="sky-sidebar-brand">
        <SkyMark className="sky-brand-mark size-8" />
        <span>Sky Chat</span>
        {onClose && <button onClick={onClose} className="sky-icon-button ml-auto" aria-label="关闭侧栏"><X size={18} /></button>}
      </div>
      <div className="px-5">
        <button onClick={onNewSession} className="sky-new-chat"><Plus size={18} />开启新对话</button>
        <label className="sky-session-search">
          <Search size={16} className="shrink-0" />
          <input aria-label="搜索历史对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={14} /></button>}
        </label>
      </div>
      <div className="sky-history-heading">
        <span>最近对话</span><span>{sessions.length}</span>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 scrollbar-thin" aria-label="历史对话">
        {filtered.length === 0 && (
          <div className="sky-history-empty">
            <MessageSquare size={22} strokeWidth={1.3} className="mx-auto mb-3" />
            {query ? "没有找到相关对话，试试其他关键词。" : <>还没有对话<br />你的对话会保存在这里。</>}
          </div>
        )}
        {filtered.map((session) => (
          <div key={session.id} className={`sky-session group ${session.id === currentSessionId ? "is-active" : ""}`}>
            <button onClick={() => onSelectSession(session.id)} className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3 text-left" aria-current={session.id === currentSessionId ? "page" : undefined} title={session.title}>
              <MessageSquare size={15} className="shrink-0 opacity-50" />
              <span className="truncate text-[13px]">{session.title}</span>
            </button>
            <button onClick={() => handleDelete(session.id)} disabled={deleting !== null} className="sky-delete-button" aria-label={`删除对话：${session.title}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </nav>
      {error && <p role="alert" className="px-5 py-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="sky-profile">
        <div className="sky-avatar">{user.email.charAt(0).toUpperCase()}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.email.split("@")[0]}</p><p className="sky-profile-email truncate">{user.email}</p></div>
        {user.role === "admin" && <Link href="/admin/knowledge" className="sky-icon-button" aria-label="管理平台" title="管理平台"><Settings2 size={16} /></Link>}
        <button onClick={onLogout} className="sky-icon-button" aria-label="退出登录" title="退出登录"><LogOut size={16} /></button>
      </div>
    </aside>
  );
}
