'use client';
import { useChatStore } from '@/store/useChatStore';

export function ThinkingIndicator() {
  const status = useChatStore((s) => s.status);

  if (status !== 'thinking') return null;

  return (
    <div className="flex items-center gap-2 p-4 text-gray-500">
      <span className="animate-pulse">🤔</span>
      <span>正在思考...</span>
    </div>
  );
}