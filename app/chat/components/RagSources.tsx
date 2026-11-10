"use client";

import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, Box, ChevronDown, FileText, List, LoaderCircle, X } from 'lucide-react';
import type { RagSource, RagTrace } from '@/lib/rag/types';

const SourceGraph3D = dynamic(() => import('./SourceGraph3D'), { ssr: false, loading: () => <p className="sky-empty-files">正在加载 3D 视图…</p> });
const CitationContext = createContext<{ trace: RagTrace; select: (id: string) => void } | null>(null);
export const useRagCitation = () => useContext(CitationContext);
class GraphBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const toolLabel: Record<string, string> = { planQueries: '理解问题', searchKnowledge: '检索资料', readDocument: '读取上下文', webSearch: '联网搜索' };
const runLabel: Record<string, string> = { running: '正在检索与整理', completed: '检索完成', failed: '本轮执行失败', cancelled: '生成已中断', budget_exceeded: '已按调用上限结束' };

function OriginalSnippet({ source }: { source: RagSource }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${encodeURIComponent(source.documentId)}?chunkId=${encodeURIComponent(source.chunkId)}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '原文加载失败');
      if (!controller.signal.aborted) setText(data.chunk.text);
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '原文加载失败'); });
    return () => controller.abort();
  }, [source.documentId, source.chunkId]);
  return <div className="sky-original-snippet"><h3>{source.name}</h3><p className="sky-source-position">{source.page ? `第 ${source.page} 页` : source.heading || '文本片段'} · {source.id}</p>{error ? <p role="alert" className="sky-inline-error">{error}。下方为生成时保留的摘录。</p> : !text ? <p className="flex items-center gap-2 text-xs"><LoaderCircle size={14} className="animate-spin" />正在读取原文…</p> : null}<blockquote>{text || source.excerpt}</blockquote>{!error && text && <a href={`/api/documents/${source.documentId}?download=1`} download className="sky-source-download">下载原文件</a>}</div>;
}

export function RagSourceProvider({ trace, children }: { trace: RagTrace | undefined; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | '3d'>('list');
  const [graphError, setGraphError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  if (!trace) return <>{children}</>;
  const select = (id: string) => { if (trace.sources.some((s) => s.id === id)) { setSelected(id); setOpen(true); } };
  const source = trace.sources.find((s) => s.id === selected);
  const fallback = <p role="status" className="sky-empty-files">当前设备无法显示 3D，仍可使用下方来源列表。</p>;
  return <CitationContext.Provider value={{ trace, select }}>
    {children}
    <section className="sky-rag-summary" aria-label="检索记录与来源">
      <details><summary><BookOpen size={14} /><span>{runLabel[trace.status] || trace.status} · {trace.sources.length} 个片段 · 引用 {trace.citedSourceIds.length} 个</span><ChevronDown size={13} /></summary>
        <ol className="sky-rag-steps">{trace.steps.map((step) => <li key={step.id}><span>{toolLabel[step.tool] || step.tool}</span><p>{step.tool === 'readDocument' ? '查看命中片段的相邻内容' : step.query}</p><small>{step.status === 'running' ? '进行中' : step.status === 'failed' ? '失败' : step.status === 'cached' ? '复用本轮结果' : `${step.durationMs} ms`}{step.sourceIds.length ? ` · ${step.sourceIds.length} 个片段` : ''}</small>{step.retrieval && <small>全文 {step.retrieval.keywordCandidates} · 向量 {step.retrieval.vectorCandidates} · {step.retrieval.rerank.status === 'applied' ? '模型重排' : step.retrieval.rerank.reason || '融合排序'} · 回填 {step.retrieval.expandedParents} 个上下文{step.retrieval.warnings?.length ? ` · ${step.retrieval.warnings.join('；')}` : ''}</small>}{step.error && <small className="sky-inline-error">{step.error}</small>}</li>)}</ol>
      </details>
      {trace.sources.length > 0 && <button className="sky-source-path" onClick={() => { setOpen(true); }}><Box size={15} />查看检索路径与原文</button>}
      {!trace.sources.length && trace.status !== 'running' && <p>本轮没有可用资料来源，请调整问题或检索范围。</p>}
      {trace.error && <p className="sky-inline-error">{trace.error}</p>}
      {trace.invalidCitationCount > 0 && <p>有 {trace.invalidCitationCount} 个来源标记未通过校验，已取消其引用链接。</p>}
    </section>
    <dialog ref={dialog} className="sky-sources-dialog" aria-label="检索路径与原文" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="sky-panel-heading"><div><h2>检索路径与原文</h2><p>布局表示检索与来源关系，空间距离不代表语义相关度。</p></div><button className="sky-icon-button" onClick={() => setOpen(false)} aria-label="关闭来源视图"><X size={18} /></button></div>
      <div className="sky-source-view-options"><div role="group" aria-label="来源视图"><button aria-pressed={mode === 'list'} onClick={() => setMode('list')}><List size={15} />列表</button><button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15} />3D 关系</button></div><span>问题 → 检索步骤 → 片段 → 文件</span></div>
      <div className="sky-source-body">
        {open && mode === '3d' && <GraphBoundary fallback={fallback}>{graphError ? fallback : <SourceGraph3D trace={trace} selectedId={selected} onSelect={setSelected} onFailure={() => setGraphError(true)} />}</GraphBoundary>}
        <div className="sky-source-columns"><div className="sky-source-list" aria-label="来源片段列表">{trace.sources.map((s) => <button key={s.id} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}><FileText size={15} /><span><strong>{s.id} · {s.name}</strong><small>{s.page ? `第 ${s.page} 页` : s.heading || '文本片段'} · {trace.citedSourceIds.includes(s.id) ? '回答已引用' : '检索命中'}</small><p>{s.excerpt.slice(0, 95)}…</p></span></button>)}</div>
          {source ? <OriginalSnippet key={source.chunkId} source={source} /> : <p className="sky-empty-files">选择左侧片段，查看原文与位置。</p>}
        </div>
      </div>
    </dialog>
  </CitationContext.Provider>;
}
