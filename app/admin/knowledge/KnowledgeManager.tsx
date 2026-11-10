"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, CloudUpload, FileText, FolderOpen, History, LoaderCircle, ScanText, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { DocumentInspector } from './DocumentInspector';
import { KnowledgeSettings } from './KnowledgeSettings';
import { ManagementShell } from '../ManagementShell';
import type { RagDocument } from '@/lib/rag/types';

type Base = { id: string; name: string; published: boolean; visibility?: string; chunkingStrategy?: string; groupGrants?: Array<{groupId:string}> };
type QueuedFile = { id: string; file: File; status: 'waiting' | 'uploading' | 'accepted' | 'failed'; error?: string; replacesId?: string };
const labels: Record<string, string> = { queued: '排队中', parsing: '解析中', embedding: '建立索引', ready: '可检索', failed: '处理失败' };
const accepted = '.pdf,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.html,.css,.sql';
export function KnowledgeManager({ user }: { user: { email: string } }) {
  const [bases, setBases] = useState<Base[]>([]);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [baseId, setBaseId] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [inspected, setInspected] = useState<RagDocument | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const uploadLock = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/knowledge?manage=1', { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '知识库加载失败');
    if (!mounted.current || signal?.aborted) return;
    setBases(data.knowledgeBases); setDocuments(data.documents); setLoading(false);
    setBaseId((old) => old || data.knowledgeBases[0]?.id || (data.documents.some((d: RagDocument) => !d.knowledgeBaseId) ? 'ungrouped' : ''));
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let active = false;
    const load = async () => { if (active) return; active = true; try { await refresh(controller.signal); } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '加载失败'); setLoading(false); } } finally { active = false; } };
    void load(); const timer = setInterval(() => void load(), 2500);
    const currentControllers = controllers.current;
    return () => { mounted.current = false; controller.abort(); clearInterval(timer); currentControllers.forEach((c) => c.abort()); };
  }, [refresh]);
  const groups = [...bases, ...(documents.some((d) => !d.knowledgeBaseId) ? [{ id: 'ungrouped', name: '未分组文件', published: false }] : [])];
  const base = groups.find((b) => b.id === baseId) || groups[0];
  const own = documents.filter((d) => d.knowledgeBaseId === (base?.id === 'ungrouped' ? null : base?.id));
  const failed = own.filter((d) => d.status === 'failed' || d.needsReindex);
  const processing = own.filter((d) => !['ready', 'failed'].includes(d.status) || ['queued','processing'].includes(d.pipeline?.status || ''));
  const ready = own.filter((d) => d.status === 'ready' && !d.needsReindex);
  const visible = own.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'ready' ? d.status === 'ready' && !d.needsReindex : filter === 'failed' ? d.status === 'failed' || d.needsReindex : !['ready', 'failed'].includes(d.status))));
  async function act(operation: () => Promise<void>) {
    if (pending) return; setPending(true); setError(null);
    try { await operation(); await refresh(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { if (mounted.current) setPending(false); }
  }
  async function api(url: string, method: string, body?: object) {
    const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败'); return data;
  }
  async function uploadFiles(files: File[], retryIds?: string[], replacesId?: string) {
    if (!base || base.id === 'ungrouped' || base.published || pending || uploadLock.current || !files.length) return;
    if (files.length > 50) { setError('单批最多 50 个文件，请分批上传。'); return; }
    uploadLock.current = true; setUploading(true); setError(null);
    const targetBase = base.id;
    const items: QueuedFile[] = files.map((file, i) => ({ id: retryIds?.[i] || crypto.randomUUID(), file, replacesId: replacesId || queue.find((q) => q.id === retryIds?.[i])?.replacesId, status: 'waiting' }));
    setQueue((old) => retryIds ? old.map((q) => items.find((i) => i.id === q.id) || q) : [...old, ...items]);
    const update = (id: string, patch: Partial<QueuedFile>) => { if (mounted.current) setQueue((old) => old.map((q) => q.id === id ? { ...q, ...patch } : q)); };
    let next = 0;
    const worker = async () => {
      while (next < items.length && mounted.current) {
        const item = items[next++]; const controller = new AbortController(); controllers.current.add(controller);
        try {
          if (!item.file.size) throw new Error('文件为空');
          if (item.file.size > 10 * 1024 * 1024) throw new Error('超过 10 MB');
          if (!accepted.split(',').some((ext) => item.file.name.toLowerCase().endsWith(ext))) throw new Error('暂不支持这种格式');
          update(item.id, { status: 'uploading', error: undefined });
          const form = new FormData(); form.append('file', item.file); form.append('knowledgeBaseId', targetBase); if (item.replacesId) form.append('replacesId', item.replacesId);
          const response = await fetch('/api/documents', { method: 'POST', body: form, signal: controller.signal });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || '上传失败');
          if (typeof data.documentId !== 'string') throw new Error('上传响应异常，请刷新确认后重试');
          update(item.id, { status: 'accepted' });
        } catch (e) { update(item.id, { status: 'failed', error: e instanceof Error ? e.message : '上传失败' }); }
        finally { controllers.current.delete(controller); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    uploadLock.current = false;
    if (mounted.current) { setUploading(false); await refresh().catch(() => setError('上传完成，列表刷新失败，请重试刷新。')); }
  }
  const locked = pending || uploading || !!base?.published;
  const queueFailed = queue.filter((q) => q.status === 'failed');
  return <ManagementShell user={user} section="knowledge">
    <div className="sky-page-heading"><div><h1>知识库</h1><p>把资料整理好，让每一段回答有据可循。</p></div><span className="sky-muted">{bases.filter((b) => b.published).length} 个已发布 · {documents.length} 个文件</span></div>
    {error && <div role="alert" className="sky-admin-notice"><CircleAlert size={17} /><span>{error}</span><button className="sky-icon-button" aria-label="关闭提示" onClick={() => setError(null)}><X size={15} /></button></div>}
    <div className="sky-library-layout"><aside className="sky-library-groups" aria-label="知识库列表"><h2>我的知识库</h2>{groups.map((b) => <button key={b.id} disabled={uploading || pending} className={baseId === b.id ? 'is-active' : ''} onClick={() => { setBaseId(b.id); setSelected([]); setFilter('all'); setQueue([]); setMoveTarget(''); }}><FolderOpen size={17} /><span>{b.name}<small>{b.published ? '已发布' : '草稿'} · {documents.filter((d) => d.knowledgeBaseId === (b.id === 'ungrouped' ? null : b.id)).length} 个文件</small></span></button>)}<form onSubmit={(e) => { e.preventDefault(); void act(async () => { const data = await api('/api/knowledge', 'POST', { name }); setBaseId(data.id); setName(''); setSelected([]); }); }}><label htmlFor="new-base">新建知识库</label><div><input id="new-base" maxLength={60} placeholder="输入名称" value={name} onChange={(e) => setName(e.target.value)} /><button className="sky-icon-button" aria-label="创建知识库" disabled={!name.trim() || pending || uploading}><Plus size={17} /></button></div></form></aside>
    <section className="sky-library-content" aria-label="文档管理">
      {loading ? <p className="sky-empty-files"><LoaderCircle className="animate-spin" size={20} />正在加载知识库…</p> : !base ? <div className="sky-library-empty"><BookPlaceholder /><h2>从一个知识库开始</h2><p>先在左侧新建知识库，再批量上传文件。<br />处理完成并发布后，所有账号都可以在聊天中选择。</p></div> : <>
        <div className="sky-library-heading"><div><h2>{base.name}</h2><p>{base.id === 'ungrouped' ? '保留的历史文件；勾选后移入草稿知识库，即可继续整理与发布。' : base.published ? (base.visibility === 'group' ? '已发布给指定用户组及其子组。' : base.visibility === 'private' ? '已发布，仅知识库所有者可见。' : '已发布给所有账号；取消发布后可继续维护。') : '草稿仅你可见，所有文件处理完成后即可发布。'}</p></div>{base.id !== 'ungrouped' && <button className={base.published ? 'sky-secondary-button' : 'sky-primary-button'} disabled={pending || uploading || (!base.published && (!own.length || ready.length !== own.length || processing.length > 0))} onClick={() => void act(() => api('/api/knowledge', 'PATCH', { id: base.id, published: !base.published }))}>{base.published ? '取消发布' : '发布知识库'}</button>}</div>
        {base.id !== 'ungrouped' && <KnowledgeSettings key={base.id} base={base} onSaved={refresh} />}
        {!base.published && base.id !== 'ungrouped' && <div className={`sky-upload-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadFiles(Array.from(e.dataTransfer.files)); }}><CloudUpload size={30} strokeWidth={1.4} /><div><strong>把文件拖到这里，或批量选择文件</strong><p>PDF、Markdown、文本与代码 · 单文件 10 MB · 每批最多 50 个</p></div><button className="sky-secondary-button" disabled={uploading || pending} onClick={() => { if (input.current) { input.current.multiple = true; delete input.current.dataset.replacesId; input.current.click(); } }}>{uploading ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />}批量上传</button><input ref={input} type="file" multiple accept={accepted} className="hidden" aria-label="批量上传知识库文件" onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; const replacesId = e.target.dataset.replacesId; void uploadFiles(files, undefined, replacesId); }} /></div>}
        {!!queue.length && <details className="sky-upload-queue" open={uploading || queueFailed.length > 0}><summary>本次上传 · 已接收 {queue.filter((q) => q.status === 'accepted').length} / {queue.length}{queueFailed.length > 0 && ` · ${queueFailed.length} 个失败`}</summary><ul>{queue.map((q) => <li key={q.id}><FileText size={14} /><span title={q.file.name}>{q.file.name}</span><small className={q.status === 'failed' ? 'sky-inline-error' : ''}>{q.error || ({ waiting: '等待上传', uploading: '上传中…', accepted: '已接收并入队', failed: '失败' })[q.status]}</small>{q.status === 'uploading' && <LoaderCircle size={13} className="animate-spin" />}{q.status === 'accepted' && <Check size={14} />}</li>)}</ul><div>{queueFailed.length > 0 && <button className="sky-secondary-button" disabled={uploading} onClick={() => void uploadFiles(queueFailed.map((q) => q.file), queueFailed.map((q) => q.id))}><RefreshCw size={14} />重试上传失败文件</button>}<button className="sky-secondary-button" disabled={uploading} onClick={() => setQueue([])}>清除上传记录</button></div></details>}
        <div className="sky-document-toolbar"><div role="group" aria-label="文档状态筛选">{[['all', `全部 ${own.length}`], ['ready', `可检索 ${ready.length}`], ['processing', `处理中 ${processing.length}`], ['failed', `需处理 ${failed.length}`]].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setSelected([]); }}>{label}</button>)}</div><label className="sky-file-search"><Search size={15} /><input placeholder="搜索文件" aria-label="搜索知识库文件" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
        {!!selected.length && <div className="sky-bulk-actions"><span>已选择 {selected.length} 个文件</span><select aria-label="移动目标知识库" value={moveTarget} disabled={locked} onChange={(e) => setMoveTarget(e.target.value)}><option value="">移动到知识库…</option>{bases.filter((b) => !b.published && b.id !== baseId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select><button disabled={locked || !moveTarget} onClick={() => void act(async () => { const results = await Promise.allSettled(selected.map((id) => api(`/api/documents/${id}`, 'PATCH', { action: 'move', knowledgeBaseId: moveTarget }))); setSelected([]); await refresh(); if (results.some((r) => r.status === 'rejected')) throw new Error('部分文件未能移动，请刷新后重试。'); setBaseId(moveTarget); setMoveTarget(''); })}>移动所选</button><button disabled={locked} onClick={() => void act(async () => { const problems = own.filter((d) => selected.includes(d.id) && (d.status === 'failed' || d.needsReindex)); if (!problems.length) throw new Error('所选文件没有可重试的任务'); const results = await Promise.allSettled(problems.map((d) => api(`/api/documents/${d.id}`, 'PATCH', { action: d.needsReindex ? 'reindex' : 'retry' }))); setSelected([]); await refresh(); if (results.some((r) => r.status === 'rejected')) throw new Error('部分任务未能重试，请刷新后查看。'); })}><RefreshCw size={14} />批量重试</button><button disabled={locked} onClick={() => { if (!window.confirm(`删除所选 ${selected.length} 个文件、全部历史版本及检索片段？`)) return; void act(async () => { const results = await Promise.allSettled(selected.map((id) => api(`/api/documents/${id}`, 'DELETE'))); setSelected([]); await refresh(); if (results.some((r) => r.status === 'rejected')) throw new Error('部分文件删除失败，请刷新后重试。'); }); }}><Trash2 size={14} />删除所选</button></div>}
        <div className="sky-document-table"><table><thead><tr><th><input type="checkbox" aria-label="选择当前列表全部文件" checked={visible.length > 0 && visible.every((d) => selected.includes(d.id))} disabled={!visible.length || locked} onChange={(e) => setSelected(e.target.checked ? visible.map((d) => d.id) : [])} /></th><th>文件</th><th>状态</th><th>片段</th><th>操作</th></tr></thead><tbody>{visible.map((d) => <tr key={d.id}><td><input type="checkbox" aria-label={`选择文件：${d.name}`} disabled={locked} checked={selected.includes(d.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((id) => id !== d.id))} /></td><td><div className="sky-file-name"><FileText size={19} strokeWidth={1.5} /><span><button className="sky-file-inspect" onClick={() => setInspected(d)}><strong>{d.name}</strong></button><small>{d.revision ? `v${d.revision} · ` : ''}{Math.max(1, Math.round(d.size / 1024))} KB · {new Date(d.createdAt).toLocaleDateString('zh-CN')}</small>{d.pendingVersion && <small className={d.pendingVersion.status === 'failed' ? 'sky-inline-error' : ''}>v{d.pendingVersion.revision} {d.pendingVersion.status === 'failed' ? '处理失败，旧版继续保留；可在版本记录中重试或移除' : '处理中，旧版继续保留'}</small>}{d.pipeline && d.pipeline.status !== 'ready' && <small>{d.pipeline.status === 'failed' ? '新索引失败，可到文件处理记录中恢复' : `索引进度 ${d.pipeline.progress}%`}</small>}{d.error && <small className="sky-inline-error">{d.error}</small>}</span></div></td><td><span className={`sky-status is-${d.needsReindex ? 'failed' : d.status}`}>{d.needsReindex ? '需重建索引' : (labels[d.status] || d.status) + (d.progress && d.status !== 'ready' && d.status !== 'failed' ? ` ${d.progress}%` : '')}</span></td><td>{d.chunkCount || '—'}</td><td><div className="flex"><button className="sky-icon-button" aria-label={`检查文件：${d.name}`} onClick={() => setInspected(d)}><ScanText size={15} /></button>{d.status === 'ready' && base.id !== 'ungrouped' && <button className="sky-icon-button" disabled={locked} aria-label={`上传新版本：${d.name}`} onClick={() => { if (input.current) { input.current.multiple = false; input.current.dataset.replacesId = d.id; input.current.click(); } }}><History size={15} /></button>}{(d.status === 'failed' || d.needsReindex) && <button className="sky-icon-button" disabled={locked} aria-label={`重试文件：${d.name}`} onClick={() => void act(() => api(`/api/documents/${d.id}`, 'PATCH', { action: d.needsReindex ? 'reindex' : 'retry' }))}><RefreshCw size={15} /></button>}<button className="sky-icon-button" disabled={locked} aria-label={`删除文件：${d.name}`} onClick={() => { if (window.confirm(`删除“${d.name}”、全部历史版本及检索片段？`)) void act(() => api(`/api/documents/${d.id}`, 'DELETE')); }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>{!visible.length && <p className="sky-empty-files">{query || filter !== 'all' ? '没有符合条件的文件。' : '还没有文件，批量上传后将在这里显示处理进度。'}</p>}</div>
        <p className="sky-library-note">文件处理在后台继续运行，可以离开此页面。PDF 最多 300 页，扫描件暂不支持 OCR。</p>
      </>}
    </section></div>
    {inspected && <DocumentInspector key={inspected.id} document={inspected} onClose={() => setInspected(null)} onSaved={refresh} locked={!!base?.published} />}
  </ManagementShell>;
}
function BookPlaceholder() { return <FolderOpen size={40} strokeWidth={1.2} className="sky-brand-mark" />; }
