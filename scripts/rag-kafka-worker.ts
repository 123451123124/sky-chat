import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { runKafkaWorker } from '../lib/rag/messaging/worker';
const controller = new AbortController();
process.on('SIGINT',()=>controller.abort()); process.on('SIGTERM',()=>controller.abort());
void runKafkaWorker(controller.signal).catch((error)=>{ console.error('Kafka RAG worker stopped:',error instanceof Error?`${error.name}: ${error.message.split('\n')[0].replace(/(password|token|authorization|api[_-]?key)[^ ,;]*/gi,'[redacted]').slice(0,300)}`:'unknown error'); process.exitCode=1; }).finally(()=>prisma.$disconnect());
