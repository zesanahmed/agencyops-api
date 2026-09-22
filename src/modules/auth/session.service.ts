import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma, type PrismaTransactionClient } from "../../lib/prisma.js";
import { hashToken } from "./auth.utils.js";
import { createAccessToken, createRefreshToken } from "./token.service.js";

export interface CreateAuthSessionInput {
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;

  client?: PrismaTransactionClient;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export async function createAuthSession(
  input: CreateAuthSessionInput,
): Promise<AuthSessionResult> {
  const db = input.client ?? prisma;
  const sessionId = randomUUID();

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken({ userId: input.userId, sessionId }),
    createRefreshToken({ userId: input.userId, sessionId }),
  ]);

  await db.session.create({
    data: {
      id: sessionId,
      userId: input.userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.jwt.refreshTokenMaxAgeMs),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
  });

  return { accessToken, refreshToken, sessionId };
}
