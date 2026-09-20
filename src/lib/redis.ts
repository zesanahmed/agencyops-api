import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Single shared ioredis connection for the whole app. Any future
 * Redis-backed infrastructure — BullMQ (see lib/queue.ts), caching,
 * rate limiting, etc. — should reuse this connection rather than
 * opening its own, so we don't accumulate redundant TCP connections
 * to Redis.
 *
 * maxRetriesPerRequest: null is BullMQ's documented requirement for
 * any connection it's given — without it, ioredis gives up retrying
 * the blocking commands BullMQ Workers rely on. Set here, at the
 * shared-connection level, rather than per-queue, so it's already
 * correct once Workers are introduced in a later task and reuse
 * this same connection.
 *
 * ioredis connects eagerly on construction but retries in the
 * background by default — the app will still start even if Redis
 * isn't reachable yet, it just won't be able to do anything
 * Redis-backed until a connection succeeds.
 */
export const redisConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (error: Error) => {
  // eslint-disable-next-line no-console
  console.error("[redis] connection error:", error.message);
});
