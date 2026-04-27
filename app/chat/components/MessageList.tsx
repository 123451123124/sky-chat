"use client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[70%] rounded-lg px-4 py-2 ${
              message.role === "user"
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-900"
            }`}
          >
            {message.content}
          </div>
        </div>
      ))}
    </div>
  );
}