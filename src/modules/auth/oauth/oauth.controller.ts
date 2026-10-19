import type { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { refreshCookieName, refreshCookieOptions } from "../../../config/cookies.js";
import { AppError } from "../../../errors/AppError.js";
import { completeOAuth, OAuthFlowError, startOAuth } from "./oauth.service.js";
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from "./oauth.providers.js";

const STATE_COOKIE = `${env.refreshCookie.name}_oauth`;
const STATE_COOKIE_PATH = "/api/v1/auth/oauth";

// SameSite=Lax (not the app's usual Strict) on purpose: the provider sends the
// browser back with a cross-site top-level navigation, and Strict cookies are
// not attached to that — the state check would always fail.
const stateCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax" as const,
  path: STATE_COOKIE_PATH,
};

function providerFrom(req: Request): OAuthProviderId {
  const { provider } = req.params as { provider: string };
  if (!(OAUTH_PROVIDER_IDS as readonly string[]).includes(provider)) {
    throw new AppError("Unknown sign-in provider", 400);
  }
  return provider as OAuthProviderId;
}

const callbackUrl = (params: Record<string, string>): string => {
  const url = new URL("/oauth/callback", `${env.frontendUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

/** GET /auth/oauth/:provider — sends the browser to the provider. */
export function begin(req: Request, res: Response): void {
  const { authorizeUrl, cookieValue } = startOAuth(providerFrom(req));
  res.cookie(STATE_COOKIE, cookieValue, { ...stateCookieOptions, maxAge: 10 * 60 * 1000 });
  res.redirect(302, authorizeUrl);
}

/**
 * GET /auth/oauth/:provider/callback — the provider's redirect target. It is a
 * browser navigation, so the outcome is a redirect to the frontend: success sets
 * the usual refresh cookie (the SPA then calls POST /auth/refresh for its access
 * token); failure carries only a fixed error code.
 */
export async function callback(req: Request, res: Response): Promise<void> {
  const providerId = providerFrom(req);
  const query = req.query as { code?: string; state?: string; error?: string };
  const cookieValue = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE];

  // One attempt per cookie, whatever the outcome.
  res.clearCookie(STATE_COOKIE, stateCookieOptions);

  try {
    const userAgent = req.headers["user-agent"];
    const { refreshToken } = await completeOAuth({
      providerId,
      code: query.code,
      state: query.state,
      providerError: query.error,
      cookieValue: typeof cookieValue === "string" ? cookieValue : undefined,
      meta: { userAgent: typeof userAgent === "string" ? userAgent : null, ipAddress: req.ip ?? null },
    });
    res.cookie(refreshCookieName, refreshToken, refreshCookieOptions);
    res.redirect(302, callbackUrl({ provider: providerId }));
  } catch (error) {
    const code = error instanceof OAuthFlowError ? error.code : "oauth_failed";
    res.redirect(302, callbackUrl({ error: code }));
  }
}
