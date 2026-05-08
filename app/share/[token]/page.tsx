import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { SharePageClient } from "./SharePageClient";

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;

  const session = await prisma.session.findUnique({
    where: { shareToken: token },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) {
    notFound();
  }

  const serializedMessages = session.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  return <SharePageClient title={session.title} messages={serializedMessages} />;
}
