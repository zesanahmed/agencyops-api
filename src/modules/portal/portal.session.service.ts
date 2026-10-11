import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { hashToken } from "../auth/auth.utils.js";
import { createClientAccessToken, createClientRefreshToken } from "./portal.token.js";

export const CLIENT_REFRESH_FAILURE_MESSAGE = "Invalid or expired refresh token";

export interface ClientSessionTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

interface SessionRecordData {
  id: string;
  clientContactId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

/** Issues tokens and persists the session via the supplied writer (so callers can pass a transaction). */
export async function createClientSession(input: {
  contactId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createSessionRecord: (data: SessionRecordData) => Promise<unknown>;
}): Promise<ClientSessionTokens> {
  const sessionId = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    createClientAccessToken(input.contactId, sessionId),
    createClientRefreshToken(input.contactId, sessionId),
  ]);

  await input.createSessionRecord({
    id: sessionId,
    clientContactId: input.contactId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.jwt.refreshTokenMaxAgeMs),
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  return { accessToken, refreshToken, sessionId };
}

/**
 * Rotates a client refresh token. A presented token that doesn't match
 * the session's current hash is treated as reuse and revokes the session.
 * The contact must still be ACTIVE — a disabled contact cannot refresh.
 */
export async function rotateClientSession(input: {
  sessionId: string;
  contactId: string;
  presentedRefreshToken: string;
}): Promise<ClientSessionTokens> {
  const fail = () => new AppError(CLIENT_REFRESH_FAILURE_MESSAGE, 401);

  const session = await prisma.clientSession.findUnique({
    where: { id: input.sessionId },
    include: { clientContact: { select: { status: true, organization: { select: { status: true, deletedAt: true } } } } },
  });

  if (!session || session.clientContactId !== input.contactId) throw fail();
  if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) throw fail();
  const contact = session.clientContact;
  if (contact.status !== "ACTIVE" || contact.organization.deletedAt !== null || contact.organization.status !== "ACTIVE") {
    throw fail();
  }

  const [accessToken, refreshToken] = await Promise.all([
    createClientAccessToken(input.contactId, input.sessionId),
    createClientRefreshToken(input.contactId, input.sessionId),
  ]);

  const { count } = await prisma.clientSession.updateMany({
    where: { id: input.sessionId, refreshTokenHash: hashToken(input.presentedRefreshToken), revokedAt: null },
    data: {
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.jwt.refreshTokenMaxAgeMs),
      lastUsedAt: new Date(),
    },
  });

  if (count === 0) {
    await revokeClientSession(input.sessionId);
    throw fail();
  }

  return { accessToken, refreshToken, sessionId: input.sessionId };
}

export async function revokeClientSession(sessionId: string): Promise<void> {
  await prisma.clientSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllClientSessions(contactId: string): Promise<void> {
  await prisma.clientSession.updateMany({
    where: { clientContactId: contactId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
