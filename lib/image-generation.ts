// Image generation needs a provider exposing the OpenAI Images API.
// Keep its configuration separate from the DashScope chat endpoint.
export function isImageGenerationConfigured() {
  return Boolean(process.env.IMAGE_API_KEY && process.env.IMAGE_BASE_URL && process.env.IMAGE_MODEL);
}

export async function generateImage(prompt: string, size = "1024x1024", signal?: AbortSignal) {
  if (!isImageGenerationConfigured()) return { error: "当前未配置图片生成服务" };
  const response = await fetch(`${process.env.IMAGE_BASE_URL!.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.IMAGE_API_KEY}` },
    body: JSON.stringify({ model: process.env.IMAGE_MODEL, prompt, size, n: 1 }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.data?.[0]?.url) {
    return { error: data.error?.message || "图片生成失败" };
  }
  return { url: data.data[0].url as string, revisedPrompt: data.data[0].revised_prompt as string | undefined };
}
