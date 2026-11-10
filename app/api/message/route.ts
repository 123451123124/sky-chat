import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const session = await prisma.session.findUnique({
      where: { id: body.sessionId, userId: user.userId },
    });
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const replacement = body.replaceMessageId;
    if (replacement !== undefined) {
      if (typeof replacement !== "string" || body.role !== "assistant") {
        return Response.json({ error: "Invalid replacement" }, { status: 400 });
      }
      // The session ownership check above also applies to regenerated answers.
      const existing = await prisma.message.findFirst({ where: { id: replacement, sessionId: session.id, role: "assistant" } });
      if (!existing) return Response.json({ error: "Message not found" }, { status: 404 });
      const message = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.message.update({
          where: { id: existing.id },
          data: { content: body.content, parts: Array.isArray(body.parts) ? body.parts : [] },
        });
        await transaction.session.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
        return updated;
      });
      return Response.json(message);
    }

    const message = await prisma.message.create({
      data: {
        sessionId: body.sessionId,
        role: body.role,
        content: body.content,
        ...(Array.isArray(body.parts) && body.parts.length > 0
          ? { parts: body.parts }
          : {}),
      },
    });

    await prisma.session.update({
      where: { id: body.sessionId },
      data: { updatedAt: new Date() },
    });

    return Response.json(message);
  } catch (e) {
    console.error("Message create error:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to create message" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId, userId: user.userId },
  });
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(messages);
}
