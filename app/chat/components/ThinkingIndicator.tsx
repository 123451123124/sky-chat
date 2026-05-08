'use client';
import { useChatStore } from '@/store/useChatStore';

export function ThinkingIndicator() {
  const status = useChatStore((s) => s.status);

  if (status === 'idle' || status === 'error') return null;

  return (
    <div className="px-4 py-2">
      {status === 'thinking' && (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse-dot" style={{ animationDelay: '0s' }} />
            <span className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse-dot" style={{ animationDelay: '0.2s' }} />
            <span className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse-dot" style={{ animationDelay: '0.4s' }} />
          </div>
          <span className="text-sm">正在思考...</span>
        </div>
      )}
      {status === 'tool_calling' && (
        <div className="flex items-center gap-2 text-blue-500">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">正在调用工具...</span>
        </div>
      )}
      {status === 'answering' && (
        <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
          <span className="text-sm">正在回复...</span>
        </div>
      )}
    </div>
  );
}
