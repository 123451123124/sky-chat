import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChatPageClient } from "./ChatPageClient";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sessions = await prisma.session.findMany({
    where: { userId: user.userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return (
    <ChatPageClient
      initialSessions={sessions.map((session) => ({
        ...session,
        updatedAt: session.updatedAt.toISOString(),
      }))}
      user={user}
    />
  );
}
