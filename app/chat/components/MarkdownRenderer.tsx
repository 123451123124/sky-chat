"use client";

import { useState, useCallback, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import type { MessagePart, TextPart, ReasoningPart, ToolPart } from '@/store/useChatStore';

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
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline decoration-blue-400/30">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-3 text-gray-600 dark:text-gray-400 italic">
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

interface MessagePartRendererProps {
  part: MessagePart;
}

let stepCounter = 0;

export function resetStepCounter() {
  stepCounter = 0;
}

export function MessagePartRenderer({ part }: MessagePartRendererProps) {
  switch (part.type) {
    case 'text':
      return (
        <MarkdownRenderer
          content={(part as TextPart).text}
          isStreaming={(part as TextPart).state === 'streaming'}
        />
      );
    case 'reasoning': {
      const reasoningPart = part as ReasoningPart;
      const isStreaming = reasoningPart.state === 'streaming';
      return (
        <div className={`mb-2 p-3 rounded-lg text-sm ${
          isStreaming
            ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700'
            : 'bg-amber-50/70 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-700/40'
        }`}>
          <div className="flex items-center gap-1 mb-1 font-medium text-amber-700 dark:text-amber-300">
            <span>💭</span>
            <span>思考过程</span>
          </div>
          <div className="whitespace-pre-wrap text-amber-800 dark:text-amber-200/90 leading-relaxed">
            {reasoningPart.text}
            {isStreaming && (
              <span className="inline-block w-0.5 h-[1em] bg-amber-500 animate-caret ml-0.5" />
            )}
          </div>
        </div>
      );
    }
    case 'tool': {
      const tool = (part as ToolPart).tool;
      const isSearch = tool.toolName === 'webSearch';

      const stateIcon = () => {
        switch (tool.state) {
          case 'input-streaming':
            return (
              <span className="flex gap-0.5 ml-2">
                <span className="w-1 h-1 bg-blue-400 rounded-full animate-typing-wave" style={{ animationDelay: '0s' }} />
                <span className="w-1 h-1 bg-blue-400 rounded-full animate-typing-wave" style={{ animationDelay: '0.2s' }} />
                <span className="w-1 h-1 bg-blue-400 rounded-full animate-typing-wave" style={{ animationDelay: '0.4s' }} />
              </span>
            );
          case 'output-available':
            return (
              <span className="animate-check-pop inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 dark:bg-green-900/40 ml-2">
                <svg className="w-2.5 h-2.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            );
          case 'output-error':
            return (
              <span className="animate-shake inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 dark:bg-red-900/40 ml-2">
                <svg className="w-2.5 h-2.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            );
          default:
            return null;
        }
      };

      return (
        <div className={`mb-2 p-3 rounded-lg text-sm ${
          isSearch
            ? 'bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700'
            : 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
        }`}>
          <div className={`flex items-center font-medium ${
            isSearch ? 'text-gray-600 dark:text-gray-400' : 'text-blue-800 dark:text-blue-200'
          }`}>
            {isSearch ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
            ) : <span>🔧</span>}
            {isSearch ? (
              <span className="text-xs ml-1">
                {tool.state === 'output-available' || tool.state === 'output-error'
                  ? '已搜索互联网'
                  : '正在搜索互联网...'}
              </span>
            ) : (
              <>
                <span>工具调用: {tool.toolName}</span>
                {stateIcon()}
                {tool.state === 'input-streaming' && (
                  <span className="text-xs text-blue-500 ml-2">接收参数中...</span>
                )}
                {tool.state === 'output-available' && (
                  <span className="text-xs text-green-600 ml-2">✓ 完成</span>
                )}
                {tool.state === 'output-error' && (
                  <span className="text-xs text-red-500 ml-2">✗ 失败</span>
                )}
              </>
            )}
          </div>
          {/* 非搜索工具才展示输入输出详情 */}
          {!isSearch && tool.input != null && (
            <pre className="text-xs bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-2 rounded overflow-x-auto mt-1">
              {typeof tool.input === 'string'
                ? tool.input
                : JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {!isSearch && tool.state === 'output-available' && tool.output != null && (
            <div className="mt-1">
              {typeof tool.output === 'object' && tool.output !== null && 'url' in (tool.output as Record<string, unknown>) ? (
                <Image
                  src={(tool.output as { url: string }).url}
                  alt="Generated"
                  className="max-w-sm rounded-lg mt-1"
                  width={384}
                  height={384}
                />
              ) : (
                <pre className="text-xs bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-2 rounded overflow-x-auto">
                  {JSON.stringify(tool.output, null, 2)}
                </pre>
              )}
            </div>
          )}
          {tool.state === 'output-error' && tool.errorText && (
            <p className="text-xs text-red-500 mt-1">{tool.errorText}</p>
          )}
        </div>
      );
    }
    case 'step-start':
      stepCounter++;
      return (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent" />
          <span className="flex-shrink-0 px-2.5 py-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full border border-gray-200/60 dark:border-gray-700/40">
            Step {stepCounter}
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent" />
        </div>
      );
    default:
      return null;
  }
}

export function StreamingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
    </div>
  );
}
