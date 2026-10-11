import type { Request, Response } from "express";
import {
  clientRefreshCookieClearOptions,
  clientRefreshCookieName,
  clientRefreshCookieOptions,
} from "../../config/cookies.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  acceptClientInvite,
  getClientSelf,
  loginClient,
  logoutAllClientSessions,
  logoutClient,
  refreshClientSession,
} from "./portal.auth.service.js";
import type { AcceptInviteBody, ClientLoginBody } from "./portal.validation.js";

function refreshCookie(req: Request): string | undefined {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[clientRefreshCookieName];
  return typeof v === "string" ? v : undefined;
}

function meta(req: Request) {
  const ua = req.headers["user-agent"];
  return { userAgent: typeof ua === "string" ? ua : null, ipAddress: req.ip ?? null };
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const body = req.body as AcceptInviteBody;
  const result = await acceptClientInvite({ ...body, ...meta(req) });
  res.cookie(clientRefreshCookieName, result.tokens.refreshToken, clientRefreshCookieOptions);
  sendSuccess(res, { accessToken: result.tokens.accessToken, contact: result.contact }, "Invitation accepted", 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as ClientLoginBody;
  const result = await loginClient({ ...body, ...meta(req) });
  res.cookie(clientRefreshCookieName, result.tokens.refreshToken, clientRefreshCookieOptions);
  sendSuccess(res, { accessToken: result.tokens.accessToken, contact: result.contact }, "Login successful");
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const tokens = await refreshClientSession(refreshCookie(req));
  res.cookie(clientRefreshCookieName, tokens.refreshToken, clientRefreshCookieOptions);
  sendSuccess(res, { accessToken: tokens.accessToken }, "Token refreshed successfully");
}

export async function logout(req: Request, res: Response): Promise<void> {
  await logoutClient(refreshCookie(req));
  res.clearCookie(clientRefreshCookieName, clientRefreshCookieClearOptions);
  sendSuccess(res, null, "Logged out successfully");
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await logoutAllClientSessions(req.client!.contactId);
  res.clearCookie(clientRefreshCookieName, clientRefreshCookieClearOptions);
  sendSuccess(res, null, "Logged out of all sessions successfully");
}

export async function me(req: Request, res: Response): Promise<void> {
  const contact = await getClientSelf(req.client!.contactId);
  sendSuccess(res, { contact }, "Current contact retrieved successfully");
}
