"use client";

import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
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

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const displayContent = isStreaming ? closeOpenMarkdownBlocks(content) : content;

  return (
    <div className={`markdown-body ${isStreaming ? 'streaming' : ''} text-sm leading-relaxed`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
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
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return (
              <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 overflow-x-auto my-2 text-sm">
                {children}
              </pre>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 bg-gray-100 dark:bg-gray-700 font-semibold text-left">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                {children}
              </td>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-2 text-gray-600 dark:text-gray-400 italic">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-5 bg-current animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

interface MessagePartRendererProps {
  part: MessagePart;
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
    case 'reasoning':
      return (
        <div className="mb-2 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-1 mb-1 font-medium">
            <span>💭</span>
            <span>思考过程</span>
          </div>
          <div className="whitespace-pre-wrap">
            {(part as ReasoningPart).text}
            {(part as ReasoningPart).state === 'streaming' && (
              <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      );
    case 'tool': {
      const tool = (part as ToolPart).tool;
      return (
        <div className="mb-2 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-sm">
          <div className="flex items-center gap-1 mb-1 font-medium text-blue-800 dark:text-blue-200">
            <span>🔧</span>
            <span>工具调用: {tool.toolName}</span>
            {tool.state === 'input-streaming' && (
              <span className="text-xs text-blue-500 ml-2">解析参数中...</span>
            )}
            {tool.state === 'input-available' && (
              <span className="text-xs text-blue-500 ml-2">执行中...</span>
            )}
            {tool.state === 'output-available' && (
              <span className="text-xs text-green-600 ml-2">✓ 完成</span>
            )}
            {tool.state === 'output-error' && (
              <span className="text-xs text-red-500 ml-2">✗ 失败</span>
            )}
          </div>
          {tool.input != null && (
            <pre className="text-xs bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-2 rounded overflow-x-auto mt-1">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {tool.state === 'output-available' && tool.output != null && (
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
      return null;
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
