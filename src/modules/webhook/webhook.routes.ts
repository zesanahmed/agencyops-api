import express, { Router, type Request, type Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../errors/AppError.js";
import { constructWebhookEvent } from "../../lib/stripe.js";
import { prisma } from "../../lib/prisma.js";
import { handleStripeEvent } from "./stripe.handlers.js";

/**
 * Stripe webhook. Mounted in app.ts BEFORE express.json(): signature
 * verification needs the exact raw bytes. Authenticity comes only from
 * the verified signature — never from cookies, tokens or the payload.
 */
const webhookRouter: Router = Router();

async function stripeWebhook(req: Request, res: Response): Promise<void> {
  if (!Buffer.isBuffer(req.body)) throw new AppError("Invalid webhook payload", 400);
  const signature = req.headers["stripe-signature"];
  const event = constructWebhookEvent(req.body, typeof signature === "string" ? signature : undefined);

  // Idempotency: one row per event id. A duplicate delivery of an already
  // processed event is acknowledged without re-running anything; one that
  // failed midway (processedAt still null) is retried.
  try {
    await prisma.webhookEvent.create({ data: { provider: "stripe", eventId: event.id, type: event.type } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: "stripe", eventId: event.id } },
      select: { processedAt: true },
    });
    if (existing?.processedAt) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
  }

  // A thrown error → 500 → Stripe retries; processedAt stays null so the retry runs again.
  await handleStripeEvent(event);
  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: "stripe", eventId: event.id } },
    data: { processedAt: new Date() },
  });
  res.status(200).json({ received: true });
}

webhookRouter.post("/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);

export { webhookRouter };
