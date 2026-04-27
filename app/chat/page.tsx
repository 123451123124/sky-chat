import { prisma } from "@/lib/prisma";
import { ChatPageClient } from "./ChatPageClient";

export default async function ChatPage() {
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return <ChatPageClient initialSessions={sessions.map((session) => ({
    ...session,
    updatedAt: session.updatedAt.toISOString(),
  }))} />;
}