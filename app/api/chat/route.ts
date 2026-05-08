import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";

const BASE_URL = process.env.OPENAI_BASE_URL || "https://yunwu.ai/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const MAX_STEPS = 5;

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

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "generateImage") {
    try {
      const response = await fetch(`${BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: args.prompt,
          n: 1,
          size: args.size || "1024x1024",
        }),
      });

      const data = await response.json();

      if (data.error) {
        return { error: data.error.message || "图片生成失败" };
      }

      return {
        url: data.data[0].url,
        revisedPrompt: data.data[0].revised_prompt,
      };
    } catch {
      return { error: "图片生成服务异常" };
    }
  }

  return { error: `Unknown tool: ${name}` };
}

function createSSEMessage(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages, model } = await req.json();
  const activeModel = model || MODEL;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const chatMessages: ChatMessage[] = messages.map(
        (m: { role: string; content: string }) => ({
          role: m.role as ChatMessage["role"],
          content: m.content,
        })
      );

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
              tools,
              stream: true,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            controller.enqueue(
              encoder.encode(
                createSSEMessage({
                  type: "error",
                  errorText: `API error: ${response.status} - ${errorText}`,
                })
              )
            );
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

                if (!delta) continue;

                if (delta.content) {
                  if (!textContent) {
                    controller.enqueue(
                      encoder.encode(
                        createSSEMessage({
                          type: "text-start",
                          id: `text-${step}`,
                        })
                      )
                    );
                  }
                  textContent += delta.content;
                  controller.enqueue(
                    encoder.encode(
                      createSSEMessage({
                        type: "text-delta",
                        id: `text-${step}`,
                        delta: delta.content,
                      })
                    )
                  );
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
                        controller.enqueue(
                          encoder.encode(
                            createSSEMessage({
                              type: "tool-input-start",
                              toolCallId: tc.id,
                              toolName: tc.function?.name || "",
                            })
                          )
                        );
                      }
                    }

                    const existing = currentToolCalls.get(idx)!;
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.name = tc.function.name;
                    if (tc.function?.arguments) {
                      existing.arguments += tc.function.arguments;
                      controller.enqueue(
                        encoder.encode(
                          createSSEMessage({
                            type: "tool-input-delta",
                            toolCallId: existing.id,
                            delta: tc.function.arguments,
                          })
                        )
                      );
                    }
                  }
                }

                if (finishReason === "tool_calls" || (finishReason === "stop" && hasToolCalls)) {
                  if (textContent) {
                    controller.enqueue(
                      encoder.encode(
                        createSSEMessage({
                          type: "text-end",
                          id: `text-${step}`,
                        })
                      )
                    );
                  }
                }

                if (finishReason === "stop" && !hasToolCalls) {
                  if (textContent) {
                    controller.enqueue(
                      encoder.encode(
                        createSSEMessage({
                          type: "text-end",
                          id: `text-${step}`,
                        })
                      )
                    );
                  }
                  controller.enqueue(
                    encoder.encode(
                      createSSEMessage({
                        type: "finish",
                        finishReason: "stop",
                      })
                    )
                  );
                  controller.close();
                  return;
                }
              } catch {
                // skip malformed JSON
              }
            }
          }

          if (textContent) {
            chatMessages.push({
              role: "assistant",
              content: textContent,
            });
          }

          if (hasToolCalls && currentToolCalls.size > 0) {
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: textContent || null,
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

              controller.enqueue(
                encoder.encode(
                  createSSEMessage({
                    type: "tool-input-available",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    input: toolInput,
                  })
                )
              );

              const output = await executeTool(tc.name, toolInput);

              const hasError =
                output &&
                typeof output === "object" &&
                "error" in (output as Record<string, unknown>);

              if (hasError) {
                controller.enqueue(
                  encoder.encode(
                    createSSEMessage({
                      type: "tool-output-error",
                      toolCallId: tc.id,
                      errorText: (output as { error: string }).error,
                    })
                  )
                );
              } else {
                controller.enqueue(
                  encoder.encode(
                    createSSEMessage({
                      type: "tool-output-available",
                      toolCallId: tc.id,
                      output,
                    })
                  )
                );
              }

              chatMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(output),
              });
            }

            controller.enqueue(
              encoder.encode(
                createSSEMessage({
                  type: "step-start",
                })
              )
            );
          } else {
            break;
          }
        }

        if (step >= MAX_STEPS) {
          controller.enqueue(
            encoder.encode(
              createSSEMessage({
                type: "finish",
                finishReason: "max-steps",
              })
            )
          );
        }

        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            createSSEMessage({
              type: "error",
              errorText: error instanceof Error ? error.message : "Unknown error",
            })
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
