'use client';
import { useChatStore } from '@/store/useChatStore';

export function ThinkingIndicator() {
  const status = useChatStore((s) => s.status);

  if (status === 'idle' || status === 'error') return null;

  return (
    <div className="px-4 py-3">
      {status === 'thinking' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-50/60 dark:bg-amber-900/15 border border-amber-200/40 dark:border-amber-700/30">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-amber-400 dark:bg-amber-500 rounded-full animate-typing-wave" style={{ animationDelay: '0s' }} />
              <span className="w-2 h-2 bg-amber-400 dark:bg-amber-500 rounded-full animate-typing-wave" style={{ animationDelay: '0.2s' }} />
              <span className="w-2 h-2 bg-amber-400 dark:bg-amber-500 rounded-full animate-typing-wave" style={{ animationDelay: '0.4s' }} />
            </div>
            <span className="text-sm text-amber-600 dark:text-amber-400 font-medium ml-1.5">正在思考...</span>
          </div>
        </div>
      )}
      {status === 'tool_calling' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-blue-50/60 dark:bg-blue-900/15 border border-blue-200/40 dark:border-blue-700/30">
            <div className="relative w-4 h-4">
              <svg className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">正在调用工具...</span>
          </div>
        </div>
      )}
      {status === 'answering' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gray-50/60 dark:bg-gray-800/30 border border-gray-200/40 dark:border-gray-700/30">
            <div className="flex items-end gap-0.5 h-4">
              <span className="w-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-typing-wave" style={{ animationDelay: '0s', height: '60%' }} />
              <span className="w-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-typing-wave" style={{ animationDelay: '0.15s', height: '100%' }} />
              <span className="w-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-typing-wave" style={{ animationDelay: '0.3s', height: '40%' }} />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">正在回复...</span>
          </div>
        </div>
      )}
    </div>
  );
}
