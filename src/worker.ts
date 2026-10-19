import "./config/load-env.js";

import { startEmailWorker } from "./jobs/email.worker.js";
import { startInvoicePdfWorker } from "./jobs/invoice-pdf.worker.js";

const workers = [startInvoicePdfWorker(), startEmailWorker()];

// eslint-disable-next-line no-console
console.log(`[agencyops-worker] started ${workers.length} worker(s)`);

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[agencyops-worker] ${signal} received, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
