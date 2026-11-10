"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message, MessagePart } from "@/store/useChatStore";
import { MessagePartRenderer, StreamingSkeleton } from "./MarkdownRenderer";
import { SkyMark } from "@/components/SkyMark";
import { ScrollToBottom } from "@/components/ScrollToBottom";
import { RagSourceProvider } from './RagSources';

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
      className="sky-copy-button"
      title="复制"
      aria-label={copied ? "已复制回复" : "复制回复"}
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
      <div className="flex justify-end gap-3 relative group">
        <div className="sky-user-bubble">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const hasContent = message.parts.length > 0 || message.content;

  return (
    <div className="flex justify-start gap-3 relative group/message">
      <div className="flex-shrink-0 mt-1">
        <SkyMark className="sky-brand-mark size-8" />
      </div>
      <div className="min-w-0 max-w-[calc(100%-3rem)]">
        <RagSourceProvider trace={message.parts.find((part) => part.type === 'rag')?.trace}>
        <div className="text-gray-900 dark:text-gray-100">
          {!hasContent && <StreamingSkeleton />}
          {message.parts.length > 0 ? (
            message.parts.map((part: MessagePart, i: number) => (
              <MessagePartRenderer key={i} part={part} stepNumber={message.parts.slice(0, i + 1).filter((p) => p.type === 'step-start').length} />
            ))
          ) : (
            message.content && (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
            )
          )}
        </div>
        </RagSourceProvider>
        <div className="sky-message-actions">
          <CopyButton content={message.content} />
          {canRegenerate && onRegenerate && (
            <button
              onClick={onRegenerate}
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
              title="从这里继续"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              继续
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MessageList({ messages, onRegenerate, canRegenerate, onBranch }: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const following = useRef(true);
  const previousScrollTop = useRef(0);
  const frame = useRef<number | null>(null);
  const lastUserId = useRef<string | undefined>(undefined);
  const touchY = useRef(0);

  const pinToBottom = useCallback(() => {
    const el = parentRef.current;
    if (!el || !following.current) return;
    el.scrollTop = el.scrollHeight;
    previousScrollTop.current = el.scrollTop;
  }, []);
  const schedulePin = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = null; pinToBottom(); });
  }, [pinToBottom]);

  // React Compiler must not memoize the virtualizer's mutable measurements.
  // eslint-disable-next-line react-hooks/incompatible-library
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
    getItemKey: (index) => messages[index].id,
  });

  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => !following.current && item.end < (instance.scrollOffset ?? 0);
  }, [virtualizer]);

  const scrollToBottom = useCallback(() => {
    following.current = true;
    pinToBottom();
    schedulePin();
    setShowScrollButton(false);
  }, [pinToBottom, schedulePin]);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    // A growing answer changes scrollHeight without expressing user intent.
    if (el.scrollTop < previousScrollTop.current - 2) following.current = false;
    else if (atBottom) following.current = true;
    previousScrollTop.current = el.scrollTop;
    setShowScrollButton(!following.current && !atBottom);
  }, []);

  useLayoutEffect(() => {
    const newestUser = [...messages].reverse().find((m) => m.role === 'user')?.id;
    if (newestUser !== lastUserId.current) { following.current = true; lastUserId.current = newestUser; setShowScrollButton(false); }
    pinToBottom();
    schedulePin();
  }, [messages, pinToBottom, schedulePin]);

  useEffect(() => {
    const observer = new ResizeObserver(schedulePin);
    if (contentRef.current) observer.observe(contentRef.current);
    if (parentRef.current) observer.observe(parentRef.current);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [schedulePin]);

  if (messages.length === 0) return null;

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onWheel={(e) => { if (e.deltaY < 0) { following.current = false; setShowScrollButton(true); } }}
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
        onTouchMove={(e) => { if (e.touches[0].clientY > touchY.current + 3) { following.current = false; setShowScrollButton(true); } touchY.current = e.touches[0].clientY; }}
        onKeyDown={(e) => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) { following.current = false; setShowScrollButton(true); } }}
        tabIndex={0}
        role="region"
        aria-label="聊天记录"
        className="absolute inset-0 overflow-y-auto sky-message-viewport"
        style={{ overflowAnchor: 'none', overscrollBehavior: 'contain', scrollBehavior: 'auto' }}
      >
        <div className="max-w-3xl mx-auto py-4 px-4 lg:px-6">
          <div
            ref={contentRef}
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
        </div>
      </div>
      <ScrollToBottom visible={showScrollButton} onClick={scrollToBottom} />
    </div>
  );
}
