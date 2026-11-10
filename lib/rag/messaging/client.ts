import { Kafka, logLevel } from 'kafkajs';
import { deadTopic, stages, stageTopic, topicPrefix } from './contracts';
let kafkaClient: Kafka | undefined;
export function kafka() {
  if (!kafkaClient) kafkaClient = new Kafka({ clientId: process.env.KAFKA_CLIENT_ID || 'sky-chat-rag', brokers: (process.env.KAFKA_BROKERS || '127.0.0.1:19092').split(',').map((s) => s.trim()),
    ssl: process.env.KAFKA_SSL === 'true', logLevel: logLevel.NOTHING, connectionTimeout: 10000, requestTimeout: 30000,
    ...(process.env.KAFKA_SASL_USERNAME ? { sasl: { mechanism: 'plain' as const, username: process.env.KAFKA_SASL_USERNAME, password: process.env.KAFKA_SASL_PASSWORD || '' } } : {}),
    retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 10000 } });
  return kafkaClient;
}
export const consumerGroup = (stage: string) => `${topicPrefix}.${stage}.workers`;
export async function ensureTopics() {
  const admin = kafka().admin(); await admin.connect();
  try { await admin.createTopics({ waitForLeaders: true, topics: [...stages.map(stageTopic), deadTopic].map((topic) => ({ topic, numPartitions: 3, replicationFactor: Number(process.env.KAFKA_REPLICATION_FACTOR || 1), configEntries: [{ name: 'retention.ms', value: String(7 * 86400000) }] })) }); }
  finally { await admin.disconnect(); }
}
