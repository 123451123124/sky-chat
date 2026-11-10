"use client";
import { useState } from 'react';
type Group = { id: string; name: string; parentId: string | null };
export function KnowledgeSettings({ base, onSaved }: { base: { id: string; published: boolean; visibility?: string; chunkingStrategy?: string; groupGrants?: Array<{ groupId: string }> }; onSaved: () => Promise<void> }) {
  const [visibility, setVisibility] = useState(base.visibility || 'public');
  const [strategy, setStrategy] = useState(base.chunkingStrategy || 'recursive');
  const [groupIds, setGroupIds] = useState((base.groupGrants || []).map((g) => g.groupId));
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  return <details className="sky-pipeline-settings" onToggle={(e) => { if (e.currentTarget.open) void fetch('/api/admin/groups').then((r) => r.json()).then((d) => setGroups(d.groups || [])).catch(() => setMessage('用户组加载失败，请重新展开。')); }}><summary>访问范围与分块策略</summary>
    <form className="sky-settings-form" onSubmit={async (e) => { e.preventDefault(); setPending(true); setMessage(''); try { const response = await fetch('/api/knowledge', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'configure', id: base.id, visibility, groupIds, chunkingStrategy: strategy }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存失败'); await onSaved(); setMessage('设置已保存；策略变化后，请重新索引现有文件。'); } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败'); } finally { setPending(false); } }}>
      <fieldset disabled={base.published || pending}><label>发布后可见范围<select value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="public">所有登录账号</option><option value="group">指定用户组及其子组</option><option value="private">仅知识库所有者</option></select></label>
      {visibility === 'group' && <label>授权用户组<select multiple aria-label="知识库授权用户组" value={groupIds} onChange={(e) => setGroupIds(Array.from(e.target.selectedOptions, (o) => o.value))}>{groups.map((g) => <option key={g.id} value={g.id}>{g.parentId ? '↳ ' : ''}{g.name}</option>)}</select></label>}
      <label>分块策略<select aria-label="分块策略" value={strategy} onChange={(e) => setStrategy(e.target.value)}><option value="recursive">结构递归＋父子分块</option><option value="semantic">语义边界＋父子分块</option></select></label><p>子块精细召回，父块补齐上下文。语义分块会增加向量请求，仅在需要时启用。</p><button className="sky-secondary-button">保存设置</button></fieldset>
      {base.published && <p className="sky-muted">请先取消发布，再修改访问范围或分块策略。</p>}{message && <p role="status" className="sky-muted">{message}</p>}
    </form>
  </details>;
}
