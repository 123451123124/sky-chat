"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message, MessagePart } from "@/store/useChatStore";
import { MessagePartRenderer, StreamingSkeleton } from "./MarkdownRenderer";
import { ScrollToBottom } from "@/components/ScrollToBottom";

interface MessageListProps {
  messages: Message[];
  onRegenerate?: () => void;
  canRegenerate?: boolean;
  onBranch?: (messageIndex: number) => void;
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
      title="复制"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}

function MessageBubble({ message, onRegenerate, canRegenerate, onBranch, index }: {
  message: Message;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
  onBranch?: (idx: number) => void;
  index: number;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 animate-fade-in-up relative group">
        <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  const hasContent = message.parts.length > 0 || message.content;

  return (
    <div className="flex justify-start gap-3 animate-fade-in-up relative group">
      <div className="flex-shrink-0 mt-1">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center shadow-sm">
          <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
      </div>
      <div className="group/message min-w-0 max-w-[calc(100%-3rem)]">
        <div className="text-gray-900 dark:text-gray-100">
          {!hasContent && <StreamingSkeleton />}
          {message.parts.length > 0 ? (
            message.parts.map((part: MessagePart, i: number) => (
              <MessagePartRenderer key={i} part={part} />
            ))
          ) : (
            message.content && (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
            )
          )}
        </div>
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover/message:opacity-100 transition-opacity">
          <CopyButton content={message.content} />
          {canRegenerate && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
              title="重新生成"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {onBranch && (
            <button
              onClick={() => onBranch(index)}
              className="p-1 text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all text-xs"
              title="从这里继续"
            >
              从这里继续
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MessageList({ messages, onRegenerate, canRegenerate, onBranch }: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isUserScrolledUp = useRef(false);

  const isFirstScroll = useRef(true);
  const isFirstScrollSettled = useRef(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const msg = messages[index];
      if (msg.role === 'user') return 60;
      const contentLen = msg.content.length;
      if (contentLen < 50) return 100;
      if (contentLen < 200) return 160;
      if (contentLen < 500) return 280;
      return 400;
    },
    overscan: 5,
  });

  const scrollToBottom = useCallback((instant = false) => {
    if (instant) {
      const el = parentRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    isUserScrolledUp.current = false;
    setShowScrollButton(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const threshold = 150;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isUserScrolledUp.current = !atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  // First scroll: useLayoutEffect runs synchronously before paint → no visible flash
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    if (!isFirstScroll.current) return;
    isFirstScroll.current = false;

    scrollToBottom(true);
    // Re-scroll after virtualizer measures actual element sizes
    requestAnimationFrame(() => {
      scrollToBottom(true);
      isFirstScrollSettled.current = true;
    });
  }, [messages, scrollToBottom]);

  // Streaming scroll: useEffect runs after paint, fine for incremental content
  useEffect(() => {
    if (messages.length === 0) return;
    if (!isFirstScrollSettled.current) return; // first scroll not yet settled
    if (isUserScrolledUp.current) return;
    scrollToBottom();
  }, [messages, scrollToBottom]);

  if (messages.length === 0) return null;

  return (
    <div className="flex-1 relative">
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto"
        style={{ overflowAnchor: 'auto' }}
      >
        <div className="max-w-3xl mx-auto py-4 px-4 lg:px-6">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const message = messages[virtualItem.index];
              return (
                <div
                  key={message.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                >
                  <div className="py-2 px-2">
                    <MessageBubble
                      message={message}
                      onRegenerate={onRegenerate}
                      canRegenerate={canRegenerate && message.role === 'assistant' && virtualItem.index === messages.length - 1}
                      onBranch={onBranch ? (idx) => onBranch(idx) : undefined}
                      index={virtualItem.index}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div ref={bottomRef} />
        </div>
      </div>
      <ScrollToBottom visible={showScrollButton} onClick={scrollToBottom} />
    </div>
  );
}
