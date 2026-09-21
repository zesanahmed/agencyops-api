import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { verifyAccessToken } from "./auth.service.js";

const BEARER_PREFIX = "Bearer ";

/**
 * Reads `Authorization: Bearer <accessToken>`, validates it, and
 * attaches the resulting SessionContext to req.auth.
 *
 * Stateless by design for this milestone: verification is done
 * entirely from the token's signature and expiry, with no database
 * lookup per request. A DB-backed revocation check (e.g. rejecting
 * tokens whose Session record has since been revoked) is a
 * heavier-weight addition for a later milestone, not this
 * foundational middleware.
 *
 * Throws AppError(401) on anything wrong, using the existing error
 * format — no try/catch needed here, Express 5 forwards a rejected
 * async handler's promise to the centralized error handler on its
 * own.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError("Authentication required", 401);
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    throw new AppError("Authentication required", 401);
  }

  const payload = await verifyAccessToken(token);

  req.auth = { userId: payload.sub, sessionId: payload.sid };
  next();
}
