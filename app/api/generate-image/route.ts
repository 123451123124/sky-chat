import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateImage, isImageGenerationConfigured } from "@/lib/image-generation";

export async function POST(req: NextRequest) {
  if (!await getCurrentUser()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isImageGenerationConfigured()) return Response.json({ error: "当前未配置图片生成服务" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (typeof body?.prompt !== "string" || !body.prompt.trim()) return Response.json({ error: "请输入图片描述" }, { status: 400 });
  try {
    const result = await generateImage(body.prompt.trim());
    return Response.json(result, { status: result.error ? 502 : 200 });
  } catch { return Response.json({ error: "图片生成服务暂时不可用" }, { status: 502 }); }
}
