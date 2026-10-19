import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import type { EmailMessage } from "./email.types.js";

/**
 * The only seam between the app and an email vendor. Business code and the
 * worker depend on this interface, never on Resend directly.
 */
export interface EmailProvider {
  /** `idempotencyKey` makes a retried job safe: the vendor drops the duplicate. */
  send(message: EmailMessage, idempotencyKey: string): Promise<void>;
}

const RESEND_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

class ResendProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only — the response and request bodies can contain tokens/addresses.
      throw new Error(`Resend rejected the email with HTTP ${response.status}`);
    }
  }
}

/** Development fallback: proves the pipeline ran without ever printing a body (it may hold a token). */
class LogProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[email] (no RESEND_API_KEY — not sent) to=${message.to} subject="${message.subject}"`);
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  if (env.email.resendApiKey) {
    provider = new ResendProvider(env.email.resendApiKey, env.email.from);
  } else if (env.isProduction) {
    throw new AppError("Email is not configured", 503);
  } else {
    provider = new LogProvider();
  }
  return provider;
}
