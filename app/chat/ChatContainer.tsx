"use client";

import { useRef, useEffect, useState } from "react";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { ThinkingIndicator } from "./components/ThinkingIndicator";
import { useChatStore } from '@/store/useChatStore';

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const status = useChatStore((s) => s.status);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const setMessages = useChatStore((s) => s.setMessages);

  const [messages, setLocalMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;

    fetch(`/api/message?sessionId=${sessionId}`)
      .then((res) => res.json())
      .then((data) => {
        setLocalMessages(data);
        setMessages(data);
      });
  }, [sessionId, setMessages]);

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, role, content }),
    });
  };

  const handleSend = async (input: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    await saveMessage("user", input);
    setLocalMessages((prev) => [...prev, userMessage]);
    setStatus('thinking');

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });

      setStatus('answering');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      };
      setLocalMessages((prev) => [...prev, assistantMessage]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += decoder.decode(value);
          setLocalMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === "assistant") {
              return [...prev.slice(0, -1), { ...lastMsg, content: assistantContent }];
            }
            return [...prev, { id: (Date.now() + Math.random()).toString(), role: "assistant" as const, content: assistantContent }];
          });
        }
      }

      await saveMessage("assistant", assistantContent);
    } catch (error) {
      console.error("Error:", error);
      setError('网络错误，请重试');
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b p-4 font-semibold">Sky Chat</header>
      <MessageList messages={messages} />
      <ThinkingIndicator />
      <div ref={messagesEndRef} />
      <ChatInput onSend={handleSend} disabled={status !== 'idle'} />
    </div>
  );
}