import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isValidModel, DEFAULT_MODEL } from "@/lib/models";
import { webSearch } from "@/lib/search";

const BASE_URL = process.env.OPENAI_BASE_URL || "https://yunwu.ai/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";
const MAX_STEPS = 5;

function buildSystemPrompt(searchEnabled: boolean): string {
  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  let prompt = `你是 Sky Chat，一个智能、专业的 AI 助手。

当前日期：${today}

## 基本规范
- 使用 Markdown 格式组织回复，合理使用标题、列表、代码块、表格等元素
- 代码块必须标注语言（如 \`\`\`python），方便语法高亮
- 对于明确的问题直接回答，不要过度追问或反复澄清
- 回复保持清晰、准确、有条理
- 数学公式使用 LaTeX 格式（$...$ 或 $$...$$）`;

  if (searchEnabled) {
    prompt += `

## 联网搜索
你可以调用 webSearch 工具搜索互联网获取最新信息。

**何时使用：**
- 问题涉及实时动态（新闻、股价、天气、赛事、最新发布等）
- 用户明确要求查找最新资料或当前数据

**何时禁止：**
- 编程、数学、常识、写作、翻译、推理分析等可直接回答的问题
- 不要因为"不确定"就搜索——优先基于你的知识直接回答
- 绝大多数问题不需要搜索

**搜索后：**
- 整理总结搜索结果，以清晰的结构呈现
- 使用 \`[来源标题](URL)\` 格式标注信息来源
- 搜索无结果或出错时如实告知用户，不要编造信息`;
  }

  return prompt;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

const SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "webSearch",
    description: "搜索互联网获取最新实时信息。仅在用户问题涉及新闻、股价、天气、赛事、最新发布等时效性内容时使用。不要用于常识、编程、数学、写作等可直接回答的问题。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
      },
      required: ["query"],
    },
  },
};

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "generateImage",
      description: "根据用户描述生成图片。当用户要求画图、生成图片、创建图像时使用此工具。",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "图片描述，英文效果更好",
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1792", "1792x1024"],
            default: "1024x1024",
            description: "图片尺寸",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const toolRegistry: Record<string, ToolHandler> = {
  generateImage: async (args) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: args.prompt,
          n: 1,
          size: args.size || "1024x1024",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.error) {
        return { error: data.error.message || "图片生成失败" };
      }

      return {
        url: data.data[0].url,
        revisedPrompt: data.data[0].revised_prompt,
      };
    } catch (e) {
      console.error("Tool execution failed:", e);
      return { error: "图片生成服务异常" };
    }
  },
  webSearch: async (args) => {
    const result = await webSearch(args.query as string);
    if (result.error) return result;
    if (result.results && result.results.length > 0) {
      return result.results.map((r, i) =>
        `[${i + 1}] ${r.title}\n来源: ${r.url}\n内容: ${r.content}`
      ).join('\n\n');
    }
    return "未找到相关搜索结果";
  },
};

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = toolRegistry[name];
  if (!handler) {
    return { error: `Unknown tool: ${name}` };
  }
  return handler(args);
}

function createSSEMessage(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { messages?: unknown; model?: unknown; searchEnabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages must be an array" }, { status: 400 });
  }

  const messages = body.messages as { role: string; content: string }[];
  const requestedModel = typeof body.model === "string" ? body.model : "";
  const activeModel = isValidModel(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const searchEnabled = body.searchEnabled === true;

  let activeTools: ToolDefinition[] = searchEnabled ? [...tools, SEARCH_TOOL] : tools;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let streamCancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      function emit(type: string, extra: Record<string, unknown> = {}) {
        if (streamCancelled) return;
        controller.enqueue(
          encoder.encode(createSSEMessage({ type, ...extra }))
        );
      }

      const chatMessages: ChatMessage[] = messages.map(
        (m: { role: string; content: string }) => ({
          role: m.role as ChatMessage["role"],
          content: m.content,
        })
      );

      chatMessages.unshift({ role: "system", content: buildSystemPrompt(searchEnabled) });

      let step = 0;

      try {
        while (step < MAX_STEPS) {
          step++;

          const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
              model: activeModel,
              messages: chatMessages,
              ...(activeTools.length > 0 ? { tools: activeTools } : {}),
              stream: true,
            }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            emit("error", { errorText: `API error: ${response.status} - ${errorText}` });
            break;
          }

          const reader = response.body?.getReader();
          if (!reader) break;

          const decoder = new TextDecoder();
          let buffer = "";
          const currentToolCalls: Map<
            number,
            { id: string; name: string; arguments: string }
          > = new Map();
          let hasToolCalls = false;
          let textContent = "";
          let reasoningContent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                const finishReason = parsed.choices?.[0]?.finish_reason;

                if (!delta && !finishReason) continue;

                if (delta.content) {
                  if (!textContent) {
                    emit("text-start", { id: `text-${step}` });
                  }
                  textContent += delta.content;
                  emit("text-delta", { id: `text-${step}`, delta: delta.content });
                }

                if (delta.reasoning_content) {
                  if (!reasoningContent) {
                    emit("reasoning-start", { id: `text-${step}` });
                  }
                  reasoningContent += delta.reasoning_content;
                  emit("reasoning-delta", { id: `text-${step}`, delta: delta.reasoning_content });
                }

                if (delta.tool_calls) {
                  hasToolCalls = true;
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!currentToolCalls.has(idx)) {
                      currentToolCalls.set(idx, {
                        id: tc.id || "",
                        name: tc.function?.name || "",
                        arguments: "",
                      });
                      if (tc.id) {
                        emit("tool-input-start", {
                          toolCallId: tc.id,
                          toolName: tc.function?.name || "",
                        });
                      }
                    }

                    const existing = currentToolCalls.get(idx)!;
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.name = tc.function.name;
                    if (tc.function?.arguments) {
                      existing.arguments += tc.function.arguments;
                      emit("tool-input-delta", {
                        toolCallId: existing.id,
                        delta: tc.function.arguments,
                      });
                    }
                  }
                }

                if (finishReason === "tool_calls" || (finishReason === "stop" && hasToolCalls)) {
                  if (reasoningContent) {
                    emit("reasoning-end", { id: `text-${step}` });
                  }
                  if (textContent) {
                    emit("text-end", { id: `text-${step}` });
                  }
                }

                if (finishReason === "stop" && !hasToolCalls) {
                  if (reasoningContent) {
                    emit("reasoning-end", { id: `text-${step}` });
                  }
                  if (textContent) {
                    emit("text-end", { id: `text-${step}` });
                  }
                  emit("finish", { finishReason: "stop" });
                  controller.close();
                  return;
                }
              } catch {
                // skip malformed JSON
              }
            }
          }

          if (textContent && !hasToolCalls) {
            chatMessages.push({
              role: "assistant",
              content: textContent,
            });
          }

          if (hasToolCalls && currentToolCalls.size > 0) {
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: textContent || "",
              tool_calls: Array.from(currentToolCalls.values()).map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              })),
            };
            chatMessages.push(assistantMsg);

            for (const tc of currentToolCalls.values()) {
              let toolInput: Record<string, unknown>;
              try {
                toolInput = JSON.parse(tc.arguments);
              } catch {
                toolInput = {};
              }

              emit("tool-input-available", {
                toolCallId: tc.id,
                toolName: tc.name,
                input: toolInput,
              });

              const output = await executeTool(tc.name, toolInput);

              const hasError =
                output !== null &&
                typeof output === "object" &&
                "error" in (output as Record<string, unknown>);

              if (hasError) {
                emit("tool-output-error", {
                  toolCallId: tc.id,
                  errorText: (output as { error: string }).error,
                });
              } else {
                emit("tool-output-available", {
                  toolCallId: tc.id,
                  output,
                });
              }

              chatMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: typeof output === 'string' ? output : JSON.stringify(output),
              });
            }

            // 搜索后移除 webSearch，插入显式指令触发 LLM 续写
            // （部分 API 代理不支持 tool 结果后自动续写，需显式 user 消息驱动）
            if (Array.from(currentToolCalls.values()).some(tc => tc.name === 'webSearch')) {
              activeTools = activeTools.filter(t => t.function.name !== 'webSearch');
              chatMessages.push({
                role: "user",
                content: "请根据以上搜索结果进行整理总结，以清晰的 Markdown 格式回复用户，标注信息来源。搜索无结果或出错请如实告知。",
              });
            }

            if (reasoningContent) {
              emit("reasoning-end", { id: `text-${step}` });
            }
            emit("step-start");
          } else {
            break;
          }
        }

        if (step >= MAX_STEPS) {
          emit("finish", { finishReason: "max-steps" });
        } else {
          // 流自然结束但模型未返回 finish_reason（部分 API 会省略），
          // 主动发 finish 防止客户端卡死
          emit("finish", { finishReason: "stop" });
        }

        controller.close();
      } catch (error: unknown) {
        if (streamCancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        emit("error", {
          errorText: error instanceof Error ? error.message : "Unknown error",
        });
        controller.close();
      }
    },
    cancel() {
      streamCancelled = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
