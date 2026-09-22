import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { hashToken } from "./auth.utils.js";
import { createAccessToken, createRefreshToken } from "./token.service.js";

export interface SessionRecordData {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface CreateAuthSessionInput {
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  /**
   * Persists the Session row. The caller supplies this — usually
   * `(data) => prisma.session.create({ data })` for a standalone
   * call (login), or `(data) => tx.session.create({ data })` from
   * inside a `prisma.$transaction(async (tx) => ...)` block
   * (register, so User + Session commit atomically).
   *
   * This function deliberately never imports or names a Prisma
   * "transaction client" type itself. Every official Prisma
   * transaction example (including the ones Prisma's own
   * `prisma init` installs as agent reference docs in this exact
   * repo, under .agents/skills/prisma-client-api/references/
   * transactions.md) uses `tx` purely inline inside the callback —
   * never exported or passed around as a standalone named type. Two
   * earlier attempts to give this function a `client?:
   * PrismaTransactionClient` parameter both broke, because both
   * relied on naming a type Prisma itself never names in its own
   * usage patterns (`Prisma.TransactionClient` turned out to have a
   * real defect for this project's generated output; a
   * hand-inferred alternative hit the same root cause). Accepting a
   * plain callback here sidesteps needing that type to exist at
   * all — `tx` (or `prisma`) is only ever referenced inline, at the
   * actual call site in auth.service.ts, exactly like Prisma's own
   * examples.
   */
  createSessionRecord: (data: SessionRecordData) => Promise<unknown>;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/**
 * Creates a Session record plus a matching access/refresh token
 * pair. Shared by register and login so this logic exists in
 * exactly one place, per the milestone's "createAuthSession" ask.
 *
 * Deliberately does NOT touch Express req/res or set any cookie —
 * it only returns the raw refreshToken value. The controller is
 * responsible for actually calling res.cookie(...) using the
 * existing centralized cookie config (config/cookies.ts), which
 * keeps this function framework-agnostic and independently
 * testable.
 *
 * The session id is generated here (not left to Prisma's default)
 * specifically so it can be embedded in the access/refresh tokens'
 * `sid` claim in the same call — Session.refreshTokenHash is a
 * required field, so the token (and its hash) must exist before the
 * Session row can be created; generating the id upfront avoids a
 * create-then-update round trip to fill that in afterward.
 */
export async function createAuthSession(
  input: CreateAuthSessionInput,
): Promise<AuthSessionResult> {
  const sessionId = randomUUID();

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken({ userId: input.userId, sessionId }),
    createRefreshToken({ userId: input.userId, sessionId }),
  ]);

  await input.createSessionRecord({
    id: sessionId,
    userId: input.userId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.jwt.refreshTokenMaxAgeMs),
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  return { accessToken, refreshToken, sessionId };
}
