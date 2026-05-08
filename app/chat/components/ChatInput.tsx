"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface FileAttachment {
  fileName: string;
  textContent: string;
  fileSize: number;
}

interface ChatInputProps {
  onSend: (message: string, file?: FileAttachment) => void;
  disabled?: boolean;
  placeholder?: string;
  centered?: boolean;
}

export function ChatInput({ onSend, disabled, placeholder, centered }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const handleSubmit = async () => {
    const text = input.trim();
    if ((!text && !file) || disabled || uploading) return;
    setSendError(null);

    if (file) {
      setUploading(true);
      setFileError(null);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          setFileError(data.error || '上传失败');
          return;
        }
        if (data.textContent === undefined || data.textContent === null) {
          setFileError('文件内容为空');
          return;
        }
        try {
          onSend(text, { fileName: data.fileName, textContent: data.textContent, fileSize: data.fileSize });
        } catch (e) {
          console.error('Send error after upload:', e);
          setFileError('发送失败，请重试');
          return;
        }
      } catch (e) {
        console.error('Upload error:', e);
        setFileError('上传失败，请重试');
        return;
      } finally {
        setUploading(false);
        setFile(null);
      }
    } else {
      try {
        onSend(text, undefined);
      } catch (e) {
        console.error('Send error:', e);
        setSendError('发送失败，请重试');
        return;
      }
    }

    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (selected.type !== 'application/pdf') {
      setFileError('仅支持 PDF 文件');
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setFileError('文件大小超过 10MB 限制');
      return;
    }
    setFile(selected);
    setFileError(null);
  };

  const clearFile = () => {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const inputContent = (
    <>
      {/* File chip */}
      {file && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-1.5 text-sm">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{file.name}</span>
            <button onClick={clearFile} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {fileError && (
        <div className="px-4 pt-2 text-xs text-red-500">{fileError}</div>
      )}
      {sendError && (
        <div className="px-4 pt-2 text-xs text-red-500">{sendError}</div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors self-end"
          title="上传 PDF"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={uploading ? "正在上传文件..." : (placeholder || "发送消息")}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 text-gray-900 dark:text-gray-100 max-h-[200px]"
          rows={1}
          disabled={disabled || uploading}
          style={{ minHeight: '24px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || (!input.trim() && !file) || uploading}
          className="p-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all self-end"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </>
  );

  if (centered) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-sm focus-within:border-gray-400 dark:focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-400/20 transition-all">
          {inputContent}
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">AI 回复仅供参考</p>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 lg:p-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-sm focus-within:border-gray-400 dark:focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-400/20 transition-all">
          {inputContent}
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">AI 回复仅供参考</p>
      </div>
    </div>
  );
}
