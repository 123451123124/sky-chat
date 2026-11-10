import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { authorizedDocuments, documentIdsSchema, RagError } from '@/lib/rag/access';

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
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Support creating a session with initial messages in a single transaction
    const { title, messages } = body;
    const documentIds = documentIdsSchema.parse(body.documentIds || []);
    await authorizedDocuments(user.userId, documentIds);

    const session = await prisma.session.create({
      data: {
        title: title || "新对话",
        userId: user.userId,
        ...(documentIds.length ? { documents: { create: documentIds.map((documentId) => ({ documentId })) } } : {}),
        ...(messages && messages.length > 0
          ? {
              messages: {
                create: messages.map((msg: { role: string; content: string; parts?: unknown }, index: number) => ({
                  role: msg.role,
                  content: msg.content,
                  createdAt: new Date(Date.now() + index),
                  ...(Array.isArray(msg.parts) && msg.parts.length > 0
                    ? { parts: msg.parts }
                    : {}),
                })),
              },
            }
          : {}),
      },
      include: { _count: { select: { messages: true } }, messages: { orderBy: { createdAt: "asc" } } },
    });

    return Response.json(session);
  } catch (e) {
    if (e instanceof RagError) return Response.json({ error: e.message }, { status: e.status });
    console.error("Session create error:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to create session" },
      { status: 500 }
    );
  }
}
