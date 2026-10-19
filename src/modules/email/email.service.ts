import { env } from "../../config/env.js";
import { getEmailProvider } from "./email.provider.js";
import { renderEmail } from "./email.templates.js";
import type { EmailJob } from "./email.types.js";

/**
 * Until real email delivery is configured (no RESEND_API_KEY) invite tokens are
 * also returned in the API response so the flow can be tried locally. Once
 * Resend is configured the token reaches the invitee by email only — the
 * inviter never sees it.
 */
export const shouldExposeInviteTokens = (): boolean => !env.email.resendApiKey;

/** Worker entry point: render, then hand to the provider. Throws on failure so BullMQ retries. */
export async function deliverEmail(job: EmailJob, idempotencyKey: string): Promise<void> {
  await getEmailProvider().send(renderEmail(job), idempotencyKey);
}
