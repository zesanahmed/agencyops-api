import type { CookieOptions } from "express";
import { env } from "./env.js";

/**
 * Centralized refresh-token cookie configuration. Setting/reading
 * this cookie (res.cookie(refreshCookieName, token,
 * refreshCookieOptions) / req.cookies[refreshCookieName]) happens in
 * the actual login/refresh/logout endpoints, implemented in a later
 * milestone — this just centralizes the options now so every place
 * that touches the cookie stays consistent with each other.
 */
export const refreshCookieName = env.refreshCookie.name;

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  maxAge: env.jwt.refreshTokenMaxAgeMs,
  // Scoped to auth endpoints only — the browser won't send this
  // cookie on every request, just the ones that need it.
  path: "/api/v1/auth",
};
