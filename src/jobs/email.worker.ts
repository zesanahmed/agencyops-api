import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis.js";
import { EMAIL_QUEUE } from "../modules/email/email.queue.js";
import { deliverEmail } from "../modules/email/email.service.js";
import type { EmailJob } from "../modules/email/email.types.js";

export function startEmailWorker(): Worker<EmailJob> {
  const worker = new Worker<EmailJob>(
    EMAIL_QUEUE,
    // job.id is stable across retries, so the vendor can deduplicate them.
    async (job) => deliverEmail(job.data, `agencyops-email-${job.id ?? "unknown"}`),
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`[email] job ${job?.id ?? "?"} (${job?.name ?? "?"}) failed (attempt ${job?.attemptsMade ?? "?"}):`, error.message);
  });
  worker.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("[email] worker error:", error.message);
  });
  return worker;
}
