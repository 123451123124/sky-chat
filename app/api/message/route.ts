import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  const message = await prisma.message.create({
    data: {
      sessionId: body.sessionId,
      role: body.role,
      content: body.content,
    },
  });
  
  // 更新会话的 updatedAt
  await prisma.session.update({
    where: { id: body.sessionId },
    data: { updatedAt: new Date() },
  });
  
  return Response.json(message);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  
  return Response.json(messages);
}