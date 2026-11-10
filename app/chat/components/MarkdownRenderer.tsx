"use client";

import { useState, useCallback, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import { Brain, Check, CircleAlert, Globe2, LoaderCircle, Wrench } from 'lucide-react';
import type { MessagePart, TextPart, ReasoningPart, ToolPart } from '@/store/useChatStore';
import { useRagCitation } from './RagSources';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

function closeOpenMarkdownBlocks(text: string): string {
  let result = text;

  const fenceMatches = result.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    result += '\n```';
  }

  const codeMatches = result.match(/(?<!`)`(?!`)/g);
  if (codeMatches && codeMatches.length % 2 !== 0) {
    result += '`';
  }

  const boldMatches = result.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    result += '**';
  }

  return result;
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const child = Array.isArray(children) ? children[0] : children;
    const codeText = isValidElement<{ children?: ReactNode }>(child) ? extractText(child.props.children) : '';
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [children]);

  return (
    <div className="relative group my-3">
      <pre className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-md p-4 overflow-x-auto text-sm leading-relaxed" style={{ boxShadow: 'none', outline: 'none' }}>
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-1 text-xs rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
      >
        {copied ? (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            已复制
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            复制
          </span>
        )}
      </button>
    </div>
  );
}

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const citation = useRagCitation();
  const displayContent = isStreaming ? closeOpenMarkdownBlocks(content) : content;

  return (
    <div className={`markdown-body ${isStreaming ? 'streaming' : ''} text-sm leading-relaxed`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`${className} text-sm`} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                <table className="min-w-full border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 font-semibold text-left text-sm border-b border-gray-200 dark:border-gray-700">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 text-sm border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
                {children}
              </td>
            );
          },
          a({ href, children }) {
            if (href?.startsWith('#rag-')) {
              const source = citation?.trace.sources.find((s) => href === `#rag-${citation.trace.runId}-${s.id}`);
              return source ? <button className="sky-inline-citation" title={`查看来源：${source.name}`} onClick={() => citation?.select(source.id)}>{children}</button> : <span title="来源尚未核实">{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline decoration-blue-400/30">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="sky-quote">
                {children}
              </blockquote>
            );
          },
          h1({ children }) {
            return <h1 className="text-lg font-semibold my-3 text-gray-900 dark:text-gray-100">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-semibold my-2.5 text-gray-900 dark:text-gray-100">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold my-2 text-gray-900 dark:text-gray-100">{children}</h3>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-sm leading-relaxed">{children}</li>;
          },
          p({ children }) {
            return <p className="my-2 text-sm leading-relaxed">{children}</p>;
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-[1em] bg-gray-600 dark:bg-gray-300 animate-caret ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

interface MessagePartRendererProps { part: MessagePart; stepNumber?: number }
export function MessagePartRenderer({ part, stepNumber = 1 }: MessagePartRendererProps) {
  switch (part.type) {
    case 'rag': return null;
    case 'text': return <MarkdownRenderer content={(part as TextPart).text} isStreaming={(part as TextPart).state === 'streaming'} />;
    case 'reasoning': {
      const reasoning = part as ReasoningPart;
      return <details className="sky-reasoning"><summary><Brain size={15} /><span>{reasoning.state === 'streaming' ? '正在思考' : '思考过程'}</span>{reasoning.state === 'streaming' && <LoaderCircle size={13} className="animate-spin" />}</summary><div>{reasoning.text}</div></details>;
    }
    case 'tool': {
      const tool = (part as ToolPart).tool;
      if (['searchKnowledge', 'readDocument'].includes(tool.toolName)) return null;
      const running = !['output-available', 'output-error'].includes(tool.state);
      const failed = tool.state === 'output-error';
      const name = ({ webSearch: '联网搜索', generateImage: '生成图片' } as Record<string, string>)[tool.toolName] || '使用工具';
      const output = tool.output as { url?: string; message?: string } | null;
      return <div className="sky-tool-result"><div><span className="sky-tool-icon">{tool.toolName === 'webSearch' ? <Globe2 size={15} /> : <Wrench size={15} />}</span><span>{name}</span><small>{failed ? '未完成' : running ? '进行中' : '已完成'}</small>{running ? <LoaderCircle size={14} className="animate-spin" /> : failed ? <CircleAlert size={14} /> : <Check size={14} />}</div>
        {failed && tool.errorText && <p className="sky-inline-error">{tool.errorText}</p>}
        {tool.state === 'output-available' && output?.url && <Image src={output.url} alt="生成的图片" className="max-w-full rounded-lg mt-3" width={384} height={384} />}
      </div>;
    }
    case 'step-start': return <div className="sky-agent-step">执行阶段 {stepNumber}</div>;
    default: return null;
  }
}
export function StreamingSkeleton() {
  return <div className="sky-waiting" role="status"><LoaderCircle size={16} className="animate-spin" /><span>正在整理回答…</span></div>;
}
