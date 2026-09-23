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

/**
 * Options for res.clearCookie() on logout. Deliberately the same as
 * refreshCookieOptions minus `maxAge`: Express's clearCookie sets an
 * expired cookie by defaulting `expires` to a date in the past, but
 * if `maxAge` is present in the options it passes to res.cookie()
 * internally, that recomputes `expires` as `Date.now() + maxAge` —
 * i.e. a future date — which would silently cancel the clear. All
 * other attributes (httpOnly/secure/sameSite/path) must still match
 * the original cookie exactly, or the browser will treat it as a
 * different cookie and never actually remove the real one.
 */
export const refreshCookieClearOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  path: "/api/v1/auth",
};
