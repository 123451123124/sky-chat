"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, Search, X } from 'lucide-react';
import type { RagDocument } from '@/lib/rag/types';

export const DOCUMENT_STATUS: Record<string, string> = { queued: '等待处理', parsing: '解析中', embedding: '向量化中', ready: '可检索', failed: '处理失败' };
interface Props {
  open: boolean; onClose: () => void; selectedIds: string[];
  onSelect: (ids: string[]) => Promise<void>; disabled: boolean;
}
export function KnowledgePanel({ open, onClose, selectedIds, onSelect, disabled }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [bases, setBases] = useState<Array<{ id: string; name: string }>>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/knowledge', { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '资料加载失败');
    if (signal?.aborted) return;
    setDocuments(Array.isArray(data.documents) ? data.documents : []);
    setBases(Array.isArray(data.knowledgeBases) ? data.knowledgeBases : []);
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!open) { ref.current?.close(); return; }
    ref.current?.showModal();
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try { await refresh(controller.signal); }
      catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '资料加载失败'); setLoading(false); } }
      finally { running = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open, refresh]);

  async function act(operation: () => Promise<void>) {
    if (pending || disabled) return;
    setPending(true); setError(null);
    try { await operation(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setPending(false); }
  }
  const visible = documents.filter((d) => d.status === 'ready' && !d.needsReindex && (filter === 'all' || d.knowledgeBaseId === filter) && d.name.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={ref} className="sky-knowledge-dialog" aria-label="文件与知识库" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sky-panel-heading"><div><h2>文件与知识库</h2><p>从管理员发布的资料中选择，本轮回答将参考这些文件。</p></div><button className="sky-icon-button" onClick={onClose} aria-label="关闭文件库"><X size={18} /></button></div>
    <div className="sky-knowledge-controls"><label>知识库<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部可用资料</option>{bases.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label className="sky-file-search"><Search size={15} /><input aria-label="搜索可用资料" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件" /></label></div>
    <div className="sky-knowledge-selection"><span>已选择 {selectedIds.length} / 12 个文件</span><div><button disabled={pending || disabled} onClick={() => void act(() => onSelect([...new Set([...selectedIds, ...visible.filter((d) => d.status === 'ready' && !d.needsReindex).map((d) => d.id)])].slice(0, 12)))}>选择本组可用文件</button><button disabled={pending || disabled || !selectedIds.length} onClick={() => void act(() => onSelect([]))}>清空选择</button></div></div>
    {error && <p role="alert" className="sky-inline-error">{error}</p>}
    <div className="sky-document-list" aria-busy={loading || pending}>
      {loading ? <p className="sky-empty-files"><LoaderCircle size={20} className="animate-spin" />正在加载资料…</p> : !visible.length ? <p className="sky-empty-files">没有可用资料。请调整筛选，或等待管理员发布知识库。</p> : visible.map((d) => <article className="sky-document-row" key={d.id}>
        <label><input type="checkbox" checked={selectedIds.includes(d.id)} disabled={disabled || pending || ((d.status !== 'ready' || d.needsReindex) && !selectedIds.includes(d.id)) || (!selectedIds.includes(d.id) && selectedIds.length >= 12)} onChange={(e) => { const checked = e.target.checked; void act(() => onSelect(checked ? [...selectedIds, d.id] : selectedIds.filter((id) => id !== d.id))); }} /><FileText size={18} /><span><strong>{d.name}</strong><small>{d.needsReindex ? '模型已变化，请重新索引' : DOCUMENT_STATUS[d.status] || d.status} · {d.status === 'ready' ? `${d.chunkCount} 个片段` : `${Math.max(1, Math.round(d.size / 1024))} KB`}</small>{d.error && <small className="sky-inline-error">{d.error}</small>}</span></label>

      </article>)}
    </div>
    <div className="sky-knowledge-footer"><p>最多选择 12 个文件。资料选择只影响当前对话。</p><button className="sky-secondary-button" onClick={onClose}>完成选择</button></div>
  </dialog>;
}
