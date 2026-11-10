"use client";

import Link from 'next/link';
import { Activity, ArrowLeft, BookOpen, FlaskConical, LayoutDashboard, Users } from 'lucide-react';
import { SkyMark } from '@/components/SkyMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ReactNode } from 'react';

export type ManagementSection = 'knowledge' | 'rag' | 'overview' | 'stall' | 'users';
const sections = [
  { id: 'knowledge', label: '知识库', icon: BookOpen, href: '/admin/knowledge' },
  { id: 'rag', label: '检索实验台', icon: FlaskConical, href: '/admin/rag' },
  { id: 'overview', label: '运行概览', icon: LayoutDashboard, href: '/admin?view=overview' },
  { id: 'stall', label: '流式性能', icon: Activity, href: '/admin?view=stall' },
  { id: 'users', label: '账号与会话', icon: Users, href: '/admin?view=users' },
] as const;

export function ManagementShell({ user, section, onSection, children }: { user: { email: string }; section: ManagementSection; onSection?: (section: 'overview' | 'stall' | 'users') => void; children: ReactNode }) {
  return <div className="sky-admin">
    <aside className="sky-admin-sidebar" aria-label="管理平台导航">
      <Link href="/chat" className="sky-sidebar-brand"><SkyMark className="sky-brand-mark size-8" /><span>Sky Chat</span></Link>
      <p className="sky-admin-nav-title">管理平台</p>
      <nav>{sections.map(({ id, label, icon: Icon, href }) => onSection && (id === 'overview' || id === 'stall' || id === 'users') ? <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { onSection(id); window.history.replaceState(null, '', href); }}><Icon size={17} />{label}</button> : <Link key={id} href={href} aria-current={section === id ? 'page' : undefined}><Icon size={17} />{label}</Link>)}</nav>
      <div className="sky-admin-profile"><div className="sky-avatar">{user.email[0].toUpperCase()}</div><span title={user.email}>{user.email}<small>管理员</small></span></div>
    </aside>
    <div className="sky-admin-workspace"><header className="sky-admin-toolbar"><span>工作空间 <span>/</span> {sections.find((s) => s.id === section)?.label}</span><div><Link href="/chat" className="sky-secondary-button"><ArrowLeft size={15} />返回聊天</Link><ThemeToggle /></div></header><main className="sky-admin-main">{children}</main></div>
  </div>;
}
