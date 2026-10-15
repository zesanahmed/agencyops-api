import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis.js";
import { INVOICE_PDF_QUEUE, type InvoicePdfJob } from "../modules/invoice/invoice.queue.js";
import { generateInvoicePdf } from "../modules/invoice/invoice.pdf.service.js";

export function startInvoicePdfWorker(): Worker<InvoicePdfJob> {
  const worker = new Worker<InvoicePdfJob>(
    INVOICE_PDF_QUEUE,
    async (job) => generateInvoicePdf(job.data.invoiceId),
    { connection: redisConnection, concurrency: 2 },
  );

  worker.on("failed", (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`[invoice-pdf] job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? "?"}):`, error.message);
  });
  worker.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("[invoice-pdf] worker error:", error.message);
  });
  return worker;
}
