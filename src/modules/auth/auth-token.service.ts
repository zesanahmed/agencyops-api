import { randomBytes } from "node:crypto";
import type { AuthTokenType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { hashToken } from "./auth.utils.js";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type TokenClient = Pick<typeof prisma, "authToken">;

/**
 * Issues a one-time token for emailing. Only the SHA-256 hash is stored; the
 * raw value exists only in the returned string (and then the email). Any older
 * unused token of the same type for the user is invalidated, so only the most
 * recent link ever works.
 */
export async function issueAuthToken(userId: string, type: AuthTokenType, ttlMs: number): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as TokenClient;
    await t.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } });
    await t.authToken.create({
      data: { userId, type, tokenHash: hashToken(rawToken), expiresAt: new Date(now.getTime() + ttlMs) },
    });
  });
  return rawToken;
}

/**
 * Atomically spends a token: the conditional UPDATE (unused AND unexpired AND
 * right type) succeeds for exactly one caller, so concurrent or repeated
 * requests cannot reuse it. Returns the owning user id, or null for anything
 * unknown, used, expired or of the wrong type — callers must not distinguish.
 *
 * Pass the transaction client so spending the token and applying its effect
 * commit or roll back together.
 */
export async function consumeAuthToken(
  client: TokenClient,
  rawToken: string,
  type: AuthTokenType,
): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const { count } = await client.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (count !== 1) return null;
  const row = await client.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}
