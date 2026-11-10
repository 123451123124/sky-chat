"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  value: string; onChange: (value: string) => void;
  disabled?: boolean; busy?: boolean; onStop?: () => void; centered?: boolean;
}
export function ChatInput({ onSend, value, onChange, disabled, busy, onStop, centered }: ChatInputProps) {
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const composing = useRef(false);
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);
  const handleSubmit = async () => {
    const text = value.trim();
    if (!text || disabled || busy || submitting.current) return;
    submitting.current = true; setError(null);
    try { await onSend(text); onChange(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败，请重试"); }
    finally { submitting.current = false; }
  };
  return <div className={`sky-composer-wrap ${centered ? "is-centered" : ""}`}>
    <div className="sky-composer">
      <textarea ref={textareaRef} value={value} onChange={(e) => onChange(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void handleSubmit(); }
      }} placeholder="把想法写下来，我们一起往下想。" aria-label="输入消息" disabled={disabled || busy} rows={2} className="sky-message-input" />
      <div className="sky-composer-actions"><span className="sky-composer-hint">需要参考资料？在顶部选择知识库。</span>
        {busy && onStop ? <button onClick={onStop} className="sky-send-button" aria-label="停止生成" title="停止生成"><Square size={14} fill="currentColor" /></button> : <button onClick={() => void handleSubmit()} disabled={disabled || !value.trim()} className="sky-send-button" aria-label="发送消息" title="发送消息"><ArrowUp size={19} /></button>}
      </div>
      {error && <p role="alert" className="px-4 pb-3 sky-inline-error">{error}</p>}
    </div>
    {!centered && <div className="sky-composer-note"><span>AI 也会有疏漏，重要信息请核实。</span><span className="sky-keyboard-hint"><kbd>Enter</kbd> 发送 <span className="mx-1">·</span> <kbd>Shift + Enter</kbd> 换行</span></div>}
  </div>;
}
