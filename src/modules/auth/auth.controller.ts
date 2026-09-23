import type { Request, Response } from "express";
import {
  refreshCookieClearOptions,
  refreshCookieName,
  refreshCookieOptions,
} from "../../config/cookies.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  getCurrentUser,
  loginUser,
  logoutAllSessions,
  logoutCurrentSession,
  refreshAuthSession,
  registerUser,
} from "./auth.service.js";
import type { LoginBody, RegisterBody } from "./auth.validation.js";

/** Reads the refresh token cookie, if present. */
function getRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[
    refreshCookieName
  ];
  return typeof value === "string" ? value : undefined;
}

function getRequestMeta(req: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  const userAgent = req.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent : null,
    ipAddress: req.ip ?? null,
  };
}

/**
 * POST /api/v1/auth/register
 * req.body is already validated + typed by validate({ body: registerSchema }).
 */
export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;
  const { userAgent, ipAddress } = getRequestMeta(req);

  const result = await registerUser({ ...body, userAgent, ipAddress });

  // Cookie options are centralized in config/cookies.ts — never
  // redefined here.
  res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);

  sendSuccess(
    res,
    { accessToken: result.accessToken, user: result.user },
    "Registration successful",
    201,
  );
}

/**
 * POST /api/v1/auth/login
 * req.body is already validated + typed by validate({ body: loginSchema }).
 */
export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginBody;
  const { userAgent, ipAddress } = getRequestMeta(req);

  const result = await loginUser({ ...body, userAgent, ipAddress });

  res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);

  sendSuccess(
    res,
    { accessToken: result.accessToken, user: result.user },
    "Login successful",
  );
}

/**
 * POST /api/v1/auth/refresh
 * Reads the refresh token from the HttpOnly cookie, rotates it, and
 * sets the new one. No request body is used or validated here — the
 * cookie is the only input.
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  const presentedToken = getRefreshCookie(req);

  const result = await refreshAuthSession(presentedToken);

  res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);

  sendSuccess(
    res,
    { accessToken: result.accessToken },
    "Token refreshed successfully",
  );
}

/**
 * POST /api/v1/auth/logout
 * Revokes the current session (if the cookie identifies one) and
 * clears the cookie either way — idempotent by design, see
 * logoutCurrentSession()'s doc comment.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const presentedToken = getRefreshCookie(req);

  await logoutCurrentSession(presentedToken);

  res.clearCookie(refreshCookieName, refreshCookieClearOptions);

  sendSuccess(res, null, "Logged out successfully");
}

/**
 * POST /api/v1/auth/logout-all
 * Authenticated (via the `authenticate` middleware — see
 * auth.routes.ts). Revokes every active session for the current
 * user, including the one making this request.
 */
export async function logoutAll(req: Request, res: Response): Promise<void> {
  const { userId } = req.auth!;

  await logoutAllSessions(userId);

  res.clearCookie(refreshCookieName, refreshCookieClearOptions);

  sendSuccess(res, null, "Logged out of all sessions successfully");
}

/**
 * GET /api/v1/auth/me
 * Authenticated. Returns only the safe user shape — see
 * getCurrentUser()'s explicit Prisma `select`.
 */
export async function me(req: Request, res: Response): Promise<void> {
  const { userId } = req.auth!;

  const user = await getCurrentUser(userId);

  sendSuccess(res, { user }, "Current user retrieved successfully");
}
