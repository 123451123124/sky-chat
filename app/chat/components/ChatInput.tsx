"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="输入消息..."
        className="flex-1"
        rows={1}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !input.trim()}>
        发送
      </Button>
    </form>
  );
}