import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  SessionContext,
} from "./auth.types.js";

const accessSecret = new TextEncoder().encode(env.jwt.accessSecret);
const refreshSecret = new TextEncoder().encode(env.jwt.refreshSecret);

const ALG = "HS256";

function parsePayload(
  payload: JWTPayload,
  expectedType: "access" | "refresh",
): { sub: string; sid: string } {
  const { sub, sid, type } = payload;
  if (typeof sub !== "string" || typeof sid !== "string") {
    throw new Error("Token payload missing required claims");
  }
  if (type !== expectedType) {
    throw new Error(`Expected a ${expectedType} token`);
  }
  return { sub, sid };
}

export async function createAccessToken(
  session: SessionContext,
): Promise<string> {
  return new SignJWT({ sid: session.sessionId, type: "access" })
    .setProtectedHeader({ alg: ALG })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(env.jwt.accessTokenExpiry)
    .sign(accessSecret);
}

/**
 * Verifies an access token. Throws AppError(401) — via the existing
 * error format — on anything wrong: bad signature, expired, or a
 * refresh token presented where an access token was expected.
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      algorithms: [ALG],
    });
    const { sub, sid } = parsePayload(payload, "access");
    return { sub, sid, type: "access" };
  } catch {
    throw new AppError("Invalid or expired access token", 401);
  }
}

export async function createRefreshToken(
  session: SessionContext,
): Promise<string> {
  return new SignJWT({ sid: session.sessionId, type: "refresh" })
    .setProtectedHeader({ alg: ALG })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(env.jwt.refreshTokenExpiry)
    .sign(refreshSecret);
}

/**
 * Verifies a refresh token. Throws AppError(401) on anything wrong
 * — same reasoning as verifyAccessToken above.
 *
 * This only checks the token's signature/expiry/claims. It does NOT
 * check the corresponding Session record in the database (e.g.
 * whether it's been revoked) — that DB-backed check, and refresh
 * rotation, belong to the actual refresh endpoint in the next
 * milestone, not this foundational service.
 */
export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret, {
      algorithms: [ALG],
    });
    const { sub, sid } = parsePayload(payload, "refresh");
    return { sub, sid, type: "refresh" };
  } catch {
    throw new AppError("Invalid or expired refresh token", 401);
  }
}
