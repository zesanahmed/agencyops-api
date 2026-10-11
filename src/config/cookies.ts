import type { CookieOptions } from "express";
import { env } from "./env.js";

export const refreshCookieName = env.refreshCookie.name;

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  maxAge: env.jwt.refreshTokenMaxAgeMs,
  path: "/api/v1/auth",
};

export const refreshCookieClearOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  path: "/api/v1/auth",
};

// Client portal sessions use their own cookie (different name AND a
// path scoped to /api/v1/portal/auth) so an internal refresh token and
// a client refresh token can never be confused or sent to the wrong
// endpoint.
export const clientRefreshCookieName = `${env.refreshCookie.name}_client`;

export const clientRefreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  maxAge: env.jwt.refreshTokenMaxAgeMs,
  path: "/api/v1/portal/auth",
};

export const clientRefreshCookieClearOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.refreshCookie.sameSite,
  path: "/api/v1/portal/auth",
};
