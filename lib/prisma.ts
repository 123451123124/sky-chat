
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  // Supabase is remote: a multi-statement outbox transaction can exceed 5s
  // even without any model or file work inside the transaction.
  transactionOptions: { maxWait: 10000, timeout: 30000 },
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
