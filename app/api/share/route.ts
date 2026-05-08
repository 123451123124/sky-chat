import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId, userId: user.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const shareToken = session.shareToken || uuidv4();

  await prisma.session.update({
    where: { id: sessionId },
    data: { shareToken },
  });

  return Response.json({ shareToken, url: `/share/${shareToken}` });
}
