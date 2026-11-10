import { z } from 'zod';
import { randomUUID } from 'node:crypto';
export const stages = ['parse', 'chunk', 'embed', 'index'] as const;
export type PipelineStage = typeof stages[number];
export const eventSchema = z.object({ eventId: z.string().uuid(), generationId: z.string().uuid(), documentId: z.string().uuid(), epoch: z.number().int().positive(), stage: z.enum(stages), profile: z.string().min(1).max(1000), traceId: z.string().uuid() }).strict();
export type PipelineEvent = z.infer<typeof eventSchema>;
export const topicPrefix = process.env.KAFKA_TOPIC_PREFIX || 'sky-chat-rag-v1';
export const stageTopic = (stage: PipelineStage) => `${topicPrefix}.${stage}.requested`;
export const deadTopic = `${topicPrefix}.dlq`;
export function nextEvent(event: Omit<PipelineEvent, 'eventId'>, stage: PipelineStage): PipelineEvent { return { ...event, eventId: randomUUID(), stage }; }
export function sourceId(generationId: string, ordinal: number) { return `${generationId}:${ordinal}`; }
