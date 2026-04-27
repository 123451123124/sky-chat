// 1. 导入
import { NextRequest } from "next/server";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

// 2. POST handler
export async function POST(req: NextRequest) {
  // 3. 解析请求体，获取 messages
  const { messages } = await req.json();

  // 4. 调用 streamText
  const result = streamText({
    model: openai("gpt-4o"),  // 这里可以换模型名，比如 "gpt-3.5-turbo"
    messages,
  });

  // 5. 返回流式响应
  return result.toUIMessageStreamResponse();
}