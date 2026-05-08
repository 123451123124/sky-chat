import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
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

  const message = await prisma.message.create({
    data: {
      sessionId: body.sessionId,
      role: body.role,
      content: body.content,
    },
  });

  await prisma.session.update({
    where: { id: body.sessionId },
    data: { updatedAt: new Date() },
  });

  return Response.json(message);
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
