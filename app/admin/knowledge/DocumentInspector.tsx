"use client";
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type { RagDocument } from '@/lib/rag/types';
type DetailDocument = RagDocument & { visibility?: string; tags?: string[]; groupGrants?: Array<{groupId:string}>; userGrants?: Array<{userId:string}> };
const states: Record<string,string> = { queued:'排队中', running:'处理中', parsing:'解析中', embedding:'建立索引', completed:'已完成', ready:'可用', failed:'失败', dead:'死信，待人工恢复' };
type Preview = { chunks: Array<{ id: string; ordinal: number; kind: string; text: string; heading: string | null; page: number | null; parentId: string | null }>; total: number; detail?: { ingestionMetrics?: { totalMs?: number; embedding?: { requests: number; cacheHits: number; retries: number } }; job?: { status: string; attempts: number; errorCode: string | null } } };
export function DocumentInspector({ document, onClose, onSaved, locked }: { document: DetailDocument; onClose: () => void; onSaved: () => Promise<void>; locked: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('chunks'); const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<Array<{id:string;revision:number;isCurrent:boolean;status:string;name:string}>>([]);
  const [groups, setGroups] = useState<Array<{id:string;name:string}>>([]); const [users, setUsers] = useState<Array<{id:string;email:string}>>([]);
  const [visibility, setVisibility] = useState(document.visibility || 'inherit'); const [tags, setTags] = useState((document.tags || []).join(', '));
  const [groupIds, setGroupIds] = useState((document.groupGrants || []).map((g) => g.groupId)); const [userIds, setUserIds] = useState((document.userGrants || []).map((g) => g.userId));
  const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string) => { const response = await fetch(url, { signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '加载失败'); return data; };
    void Promise.all([read(`/api/documents/${document.id}?preview=1&offset=${offset}`), read(`/api/documents/${document.id}?versions=1`), read('/api/admin/groups')]).then(([data, history, access]) => { if (!controller.signal.aborted) { setPreview(data); setVersions(history.versions || []); setGroups(access.groups || []); setUsers(access.users || []); } }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [document.id, offset]);
  const embedding = preview?.detail?.ingestionMetrics?.embedding;
  return <dialog ref={dialog} className="sky-admin-dialog" aria-label="文档检查" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sky-panel-heading"><div><h2>{document.name}</h2><p>检查实际入库内容、权限与版本。</p></div><button className="sky-icon-button" aria-label="关闭文档检查" onClick={onClose}><X size={18} /></button></div>
    <div className="sky-inspector-tabs">{[['chunks','分块预览'],['access','访问与标签'],['versions','版本记录']].map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="sky-inspector-body">{error && <p role="alert" className="sky-inline-error">{error}</p>}
      {tab === 'chunks' && (!preview ? <p className="sky-empty-files"><LoaderCircle size={16} className="animate-spin" />正在读取分块…</p> : <><p className="sky-muted">共 {preview.total} 个父块与子块 · {preview.detail?.job ? `任务 ${states[preview.detail.job.status] || preview.detail.job.status} · 尝试 ${preview.detail.job.attempts} 次` : '暂无处理记录'}{embedding && ` · 向量请求 ${embedding.requests} 次 · 缓存命中 ${embedding.cacheHits} 个 · 重试 ${embedding.retries} 次`}</p><div className="sky-chunk-preview">{preview.chunks.map((c) => <article key={c.id}><header><span className="sky-status">{c.kind === 'parent' ? '上下文父块' : '检索子块'} {c.ordinal + 1}</span><span>{c.page ? `第 ${c.page} 页` : c.heading || '正文'} · {c.text.length} 字符</span></header><p>{c.text}</p></article>)}</div>{!preview.chunks.length && <p className="sky-empty-files">尚无分块，请等待文件处理完成或检查失败原因。</p>}<div className="sky-pagination"><button className="sky-secondary-button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</button><span>{offset + 1}–{Math.min(offset + 30, preview.total)} / {preview.total}</span><button className="sky-secondary-button" disabled={offset + 30 >= preview.total} onClick={() => setOffset(offset + 30)}>下一页</button></div></>)}
      {tab === 'access' && <form className="sky-settings-form" onSubmit={async (e) => {
        e.preventDefault(); setPending(true); setError(''); setNotice('');
        try { const response = await fetch(`/api/documents/${document.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'permissions',visibility,groupIds,userIds,tags:tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)}) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存失败'); await onSaved(); setNotice('文件访问设置已保存。'); }
        catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setPending(false); }
      }}><fieldset disabled={locked || pending}><label>文件访问范围<select value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="inherit">继承知识库</option><option value="private">仅文件所有者</option><option value="restricted">指定账号或用户组</option></select></label>
      {visibility === 'restricted' && <><label>用户组<select multiple aria-label="文件授权用户组" value={groupIds} onChange={(e) => setGroupIds(Array.from(e.target.selectedOptions, (o) => o.value))}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>账号<select multiple aria-label="文件授权账号" value={userIds} onChange={(e) => setUserIds(Array.from(e.target.selectedOptions, (o) => o.value))}>{users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select></label></>}
      <label>检索标签<input aria-label="文件检索标签" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如：课程, 2026, 产品手册" /></label><p>文件授权可进一步收紧知识库范围。访问者需要同时满足知识库和文件授权，且知识库已发布；修改会同步覆盖历史版本。</p><button className="sky-primary-button">保存文件设置</button></fieldset>{locked && <p className="sky-muted">维护权限前请先取消发布。</p>}{notice && <p role="status" className="sky-muted">{notice}</p>}</form>}
      {tab === 'versions' && <div className="sky-version-list">{versions.map((v) => <article key={v.id}><strong>版本 {v.revision} · {v.name}</strong><span className="sky-status">{v.isCurrent ? '当前版本' : v.status === 'ready' ? '历史版本' : '未启用'} · {states[v.status] || v.status}</span>
      {v.status === 'failed' && <button className="sky-secondary-button" disabled={locked || pending} onClick={() => void versionAction(v.id, 'retry')}>重试版本 {v.revision}</button>}
      {!v.isCurrent && <button className="sky-secondary-button" disabled={locked || pending} onClick={() => { if (window.confirm(`删除版本 ${v.revision} 的原文件及片段？当前版本会保留。`)) void versionAction(v.id, 'delete'); }}>删除版本 {v.revision}</button>}
      </article>)}<p className="sky-muted">新版本处理成功后切换会话资料；失败时保留旧版。历史回答可继续定位原有片段。</p></div>}
    </div>
  </dialog>;
  async function versionAction(id: string, action: 'retry' | 'delete') {
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/documents/${id}${action === 'delete' ? '?versionOnly=1' : ''}`, { method: action === 'delete' ? 'DELETE' : 'PATCH', headers: { 'Content-Type':'application/json' }, ...(action === 'retry' ? { body:JSON.stringify({action:'retry'}) } : {}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败');
      const history = await (await fetch(`/api/documents/${document.id}?versions=1`)).json(); setVersions(history.versions || []); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setPending(false); }
  }
}
