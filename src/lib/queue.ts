import { Queue, type QueueOptions } from "bullmq";
import { redisConnection } from "./redis.js";

/**
 * Creates a BullMQ Queue bound to the shared Redis connection.
 * Business modules (notifications, invoice PDF generation, AI/RAG
 * processing, etc.) should call this instead of constructing their
 * own `new Queue(...)` with ad-hoc connection options, so every
 * queue in the app goes through one consistent connection.
 *
 * No queues are created here — this is only the factory. No
 * Workers are created here either; queue producers (this) and
 * queue consumers (Workers) are separate concerns, and Workers
 * are out of scope for this task.
 */
export function createQueue<DataType = unknown, ResultType = unknown>(
  name: string,
  options?: Omit<QueueOptions, "connection">,
): Queue<DataType, ResultType> {
  return new Queue<DataType, ResultType>(name, {
    ...options,
    connection: redisConnection,
  });
}
