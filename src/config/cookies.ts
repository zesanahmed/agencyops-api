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
