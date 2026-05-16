import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { metrics, url, userAgent, timestamp } = body;

    if (!metrics || !Array.isArray(metrics)) {
      return Response.json({ error: "Invalid metrics data" }, { status: 400 });
    }

    for (const metric of metrics) {
      const clientId = metric.id || null;
      const baseId = clientId ? clientId.replace(/-(ttlb|stall)$/, '') : null;
      await prisma.monitorMetric.create({
        data: {
          type: metric.type,
          name: metric.name,
          value: metric.value,
          url: url || "",
          userAgent: userAgent || "",
          sessionId: metric.sessionId || null,
          metadata: { ...(metric.metadata || {}), _requestId: baseId },
          timestamp: new Date(timestamp || Date.now()),
        },
      });
    }

    return Response.json({ success: true, count: metrics.length });
  } catch (error) {
    console.error("Monitor API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "100");

  const where = type ? { type } : {};

  const metrics = await prisma.monitorMetric.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return Response.json(metrics);
}
