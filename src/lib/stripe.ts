import Stripe from "stripe";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

let client: Stripe | undefined;

/**
 * Lazily creates the Stripe client. A missing key is a clean 503, not a
 * crash at startup. All Stripe API calls in the app go through this one
 * accessor, so a future change (e.g. Stripe Connect's per-request
 * `stripeAccount`) has a single place to land.
 */
export function getStripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw new AppError("Payments are not configured", 503);
  }
  client ??= new Stripe(env.stripe.secretKey);
  return client;
}

/**
 * Verifies a webhook's signature and parses the event. Takes the RAW
 * request body — any re-serialization after JSON parsing would break
 * the signature. Throws AppError(400) on a missing/invalid signature.
 *
 * Needs no network and no API key beyond the webhook secret, so it
 * uses its own throwaway client.
 */
export function constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!env.stripe.webhookSecret) {
    throw new AppError("Payments are not configured", 503);
  }
  if (!signature) {
    throw new AppError("Missing Stripe signature", 400);
  }
  try {
    return new Stripe("sk_unused_for_signature_verification").webhooks.constructEvent(
      rawBody,
      signature,
      env.stripe.webhookSecret,
    );
  } catch {
    throw new AppError("Invalid Stripe signature", 400);
  }
}
