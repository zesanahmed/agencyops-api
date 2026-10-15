import type { Queue } from "bullmq";
import { AppError } from "../../errors/AppError.js";

export const INVOICE_PDF_QUEUE = "invoice-pdf";

export interface InvoicePdfJob {
  invoiceId: string;
}

const ENQUEUE_TIMEOUT_MS = 3000;

let queue: Queue<InvoicePdfJob> | undefined;

/**
 * Created on first use. Importing lib/queue.js opens the shared Redis
 * connection, so doing it lazily keeps the app (and its tests) from
 * touching Redis until something is actually enqueued.
 */
async function getQueue(): Promise<Queue<InvoicePdfJob>> {
  if (!queue) {
    const { createQueue } = await import("../../lib/queue.js");
    queue = createQueue<InvoicePdfJob>(INVOICE_PDF_QUEUE, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return queue;
}

/**
 * Queues PDF (re)generation for an invoice. Throws a 503 AppError if Redis
 * is unreachable — with ioredis's unlimited retries a plain `add` would
 * otherwise hang the request forever.
 */
export async function enqueueInvoicePdf(invoiceId: string): Promise<void> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS).unref();
  });
  try {
    await Promise.race([getQueue().then((q) => q.add("generate", { invoiceId })), timeout]);
  } catch {
    throw new AppError("Background processing is currently unavailable", 503);
  }
}

/**
 * Fire-and-forget variant for side effects of an already-committed business
 * change (send/pay/void): the PDF can always be regenerated later, so a
 * queue outage must never fail or delay the request that triggered it.
 */
export function enqueueInvoicePdfQuietly(invoiceId: string): void {
  enqueueInvoicePdf(invoiceId).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[invoice-pdf] could not enqueue job:", error instanceof Error ? error.message : error);
  });
}
