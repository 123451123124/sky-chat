import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminPageClient } from "./AdminPageClient";

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin") {
    redirect("/chat");
  }

  const [users, sessions, metrics] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { sessions: true } } },
    }),
    prisma.session.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { messages: true } } },
      take: 500,
    }),
    prisma.monitorMetric.findMany({
      orderBy: { timestamp: "desc" },
      take: 500,
    }),
  ]);

  const serializedUsers = users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  }));

  const serializedSessions = sessions.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));

  const serializedMetrics = metrics.map((m) => ({
    ...m,
    timestamp: m.timestamp.toISOString(),
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <AdminPageClient
      currentUser={user}
      users={serializedUsers}
      sessions={serializedSessions}
      metrics={serializedMetrics}
    />
  );
}
