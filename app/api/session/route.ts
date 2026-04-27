import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return Response.json(sessions);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const session = await prisma.session.create({
    data: { title: body.title || "新对话" },
  });
  return Response.json(session);
}