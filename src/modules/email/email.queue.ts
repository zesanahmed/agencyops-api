import type { Queue } from "bullmq";
import { AppError } from "../../errors/AppError.js";
import type { EmailJob } from "./email.types.js";

export const EMAIL_QUEUE = "email";

const ENQUEUE_TIMEOUT_MS = 3000;

let queue: Queue<EmailJob> | undefined;

/** Created on first use so the app (and its tests) never touch Redis until mail is queued. */
async function getQueue(): Promise<Queue<EmailJob>> {
  if (!queue) {
    const { createQueue } = await import("../../lib/queue.js");
    queue = createQueue<EmailJob>(EMAIL_QUEUE, {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        // Jobs can carry one-time tokens: do not keep them around after success,
        // and only briefly after failure.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600, count: 200 },
      },
    });
  }
  return queue;
}

/** Throws a 503 if Redis is unreachable (a plain `add` would otherwise hang forever). */
export async function enqueueEmail(job: EmailJob): Promise<void> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS).unref();
  });
  try {
    await Promise.race([getQueue().then((q) => q.add(job.type, job)), timeout]);
  } catch {
    throw new AppError("Background processing is currently unavailable", 503);
  }
}

/**
 * Fire-and-forget, for side effects of an already-committed change: a Redis
 * outage must never fail the request that triggered the email.
 */
export function enqueueEmailQuietly(job: EmailJob): void {
  enqueueEmail(job).catch((error: unknown) => {
    // Never log the job itself — it can contain a token.
    // eslint-disable-next-line no-console
    console.error(`[email] could not enqueue ${job.type}:`, error instanceof Error ? error.message : error);
  });
}
