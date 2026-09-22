import type { Request, Response } from "express";
import { refreshCookieName, refreshCookieOptions } from "../../config/cookies.js";
import { AppError } from "../../errors/AppError.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import { loginUser, registerUser } from "./auth.service.js";
import type { LoginBody, RegisterBody } from "./auth.validation.js";

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
 * POST /api/v1/auth/refresh — route/controller structure only.
 * Actual refresh-token verification, rotation, and reissuing an
 * access token is explicitly the next milestone's work, not this
 * one (see the register+login milestone's scope constraints).
 */
export async function refresh(_req: Request, _res: Response): Promise<void> {
  throw new AppError("Refresh is not implemented yet", 501);
}

/**
 * POST /api/v1/auth/logout — route/controller structure only, same
 * reasoning as refresh() above.
 */
export async function logout(_req: Request, _res: Response): Promise<void> {
  throw new AppError("Logout is not implemented yet", 501);
}

/**
 * GET /api/v1/auth/me — route/controller structure only. Wired
 * behind the authenticate middleware (see auth.routes.ts) so the
 * full pipeline (token validation → req.auth populated → handler)
 * is demonstrated end-to-end, but fetching and returning the actual
 * user profile is deferred, same reasoning as above.
 */
export async function me(_req: Request, _res: Response): Promise<void> {
  throw new AppError("Not implemented yet", 501);
}
