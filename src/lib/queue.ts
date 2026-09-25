import { Queue, type QueueOptions } from "bullmq";
import { redisConnection } from "./redis.js";

export function createQueue<DataType = unknown, ResultType = unknown>(
  name: string,
  options?: Omit<QueueOptions, "connection">,
): Queue<DataType, ResultType> {
  return new Queue<DataType, ResultType>(name, {
    ...options,
    connection: redisConnection,
  });
}
