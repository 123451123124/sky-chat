import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await prisma.session.findMany({
    where: { userId: user.userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return Response.json(sessions);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Support creating a session with initial messages in a single transaction
  const { title, messages } = body;

  const session = await prisma.session.create({
    data: {
      title: title || "新对话",
      userId: user.userId,
      ...(messages && messages.length > 0
        ? {
            messages: {
              create: messages.map((msg: { role: string; content: string }) => ({
                role: msg.role,
                content: msg.content,
              })),
            },
          }
        : {}),
    },
    include: { _count: { select: { messages: true } } },
  });

  return Response.json(session);
}
