import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";

// Same signing secrets as internal auth, but a distinct `type` claim
// ("client_access" / "client_refresh"). Internal verifyAccessToken()
// only accepts type "access", and the functions below only accept the
// client types, so a token from one boundary is rejected by the other.
const accessSecret = new TextEncoder().encode(env.jwt.accessSecret);
const refreshSecret = new TextEncoder().encode(env.jwt.refreshSecret);
const ALG = "HS256";

type ClientTokenType = "client_access" | "client_refresh";

async function sign(
  type: ClientTokenType,
  contactId: string,
  sessionId: string,
  secret: Uint8Array,
  expiry: string,
): Promise<string> {
  return new SignJWT({ sid: sessionId, type })
    .setProtectedHeader({ alg: ALG })
    .setSubject(contactId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secret);
}

export const createClientAccessToken = (contactId: string, sessionId: string) =>
  sign("client_access", contactId, sessionId, accessSecret, env.jwt.accessTokenExpiry);

export const createClientRefreshToken = (contactId: string, sessionId: string) =>
  sign("client_refresh", contactId, sessionId, refreshSecret, env.jwt.refreshTokenExpiry);

async function verify(
  token: string,
  type: ClientTokenType,
  secret: Uint8Array,
  failureMessage: string,
): Promise<{ sub: string; sid: string }> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (payload.type !== type || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw new Error("bad claims");
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    throw new AppError(failureMessage, 401);
  }
}

export const verifyClientAccessToken = (token: string) =>
  verify(token, "client_access", accessSecret, "Invalid or expired access token");

export const verifyClientRefreshToken = (token: string) =>
  verify(token, "client_refresh", refreshSecret, "Invalid or expired refresh token");
