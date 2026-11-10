import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const db = new PrismaClient();
  try {
    const extensions = await db.$queryRaw<Array<{ installed_version: string | null }>>`SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'`;
    console.log(JSON.stringify({ database: 'reachable', pgvectorAvailable: extensions.length > 0, pgvectorInstalled: !!extensions[0]?.installed_version }));
  } catch { console.log(JSON.stringify({ database: 'unreachable' })); }
  finally { await db.$disconnect(); }
  try {
    const response = await fetch(`${(process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || ''}` },
      body: JSON.stringify({ model: process.env.EMBEDDING_MODEL || 'text-embedding-v4', input: ['连接检查'], dimensions: 1024, encoding_format: 'float' }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    console.log(JSON.stringify({ embeddingStatus: response.status, dimensions: data.data?.[0]?.embedding?.length || null, errorCode: data.error?.code || null }));
  } catch { console.log(JSON.stringify({ embeddingStatus: 'unreachable' })); }
}
void main();
