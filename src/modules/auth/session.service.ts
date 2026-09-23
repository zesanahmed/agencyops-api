import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { hashToken } from "./auth.utils.js";
import { createAccessToken, createRefreshToken } from "./token.service.js";

export const REFRESH_FAILURE_MESSAGE = "Invalid or expired refresh token";

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

  createSessionRecord: (data: SessionRecordData) => Promise<unknown>;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

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

export interface RotateAuthSessionInput {
  sessionId: string;
  userId: string;
  /** The raw refresh token exactly as presented by the client. */
  presentedRefreshToken: string;
}

export async function rotateAuthSession(
  input: RotateAuthSessionInput,
): Promise<AuthSessionResult> {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
  });

  if (!session || session.userId !== input.userId) {
    throw new AppError(REFRESH_FAILURE_MESSAGE, 401);
  }
  if (session.revokedAt !== null) {
    throw new AppError(REFRESH_FAILURE_MESSAGE, 401);
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new AppError(REFRESH_FAILURE_MESSAGE, 401);
  }

  const presentedHash = hashToken(input.presentedRefreshToken);

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken({ userId: input.userId, sessionId: input.sessionId }),
    createRefreshToken({ userId: input.userId, sessionId: input.sessionId }),
  ]);

  const { count } = await prisma.session.updateMany({
    where: {
      id: input.sessionId,
      refreshTokenHash: presentedHash,
      revokedAt: null,
    },
    data: {
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.jwt.refreshTokenMaxAgeMs),
      lastUsedAt: new Date(),
    },
  });

  if (count === 0) {
    await revokeSession(input.sessionId);
    throw new AppError(REFRESH_FAILURE_MESSAGE, 401);
  }

  return { accessToken, refreshToken, sessionId: input.sessionId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
