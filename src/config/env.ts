/**
 * Centralized environment configuration.
 *
 * Business modules should import `env` from here instead of
 * reading `process.env` directly, so environment access stays
 * in one place as more variables (DB, Redis, OAuth, etc.) are
 * introduced in later stages.
 *
 * .env loading happens separately, in config/load-env.ts, which
 * must run before this module is ever imported (see that file for
 * why). This module itself just reads whatever is already in
 * process.env by the time it's evaluated.
 */

type NodeEnv = "development" | "production" | "test";

function resolveNodeEnv(value: string | undefined): NodeEnv {
  if (value === "production" || value === "test") {
    return value;
  }
  return "development";
}

function resolvePort(value: string | undefined): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 5000;
}

// Falls back to a local-dev default so `npm run dev` works out of the
// box without a .env file. This is a convenience default, not a
// hardcoded credential — any real (staging/production) Redis
// instance is expected to come from the REDIS_URL environment
// variable, never from this fallback.
function resolveRedisUrl(value: string | undefined): string {
  if (value && value.trim() !== "") {
    return value;
  }
  return "redis://127.0.0.1:6379";
}

/**
 * Parses a simple duration string like "15m", "2h", "30d" into
 * milliseconds. Supports s(econds)/m(inutes)/h(ours)/d(ays)/w(eeks).
 * Deliberately minimal — just enough for token/cookie expiry, to
 * avoid a dependency (e.g. `ms`) for this alone. jose's own
 * setExpirationTime() accepts the same raw duration string directly,
 * so the string form is kept as-is for that; this is only used to
 * turn the same value into a millisecond number for cookie maxAge.
 */
const DURATION_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i;
const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDurationMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid duration "${value}" — expected a number followed by s/m/h/d/w, e.g. "15m".`,
    );
  }
  const unitMs = DURATION_UNIT_MS[match[2].toLowerCase()];
  if (unitMs === undefined) {
    throw new Error(`Invalid duration unit in "${value}".`);
  }
  return Number(match[1]) * unitMs;
}

function resolveDuration(value: string | undefined, fallback: string): string {
  const raw = value && value.trim() !== "" ? value : fallback;
  // Validate eagerly so a malformed env value fails at startup,
  // not the first time a token happens to be issued.
  parseDurationMs(raw);
  return raw;
}

type SameSite = "strict" | "lax" | "none";

function resolveSameSite(value: string | undefined): SameSite {
  if (value === "lax" || value === "none") {
    return value;
  }
  return "strict";
}

/**
 * JWT/session secrets must never have an insecure default in
 * production — that would mean a missing env var silently degrades
 * to a well-known, guessable secret. So: throw immediately at
 * startup if missing in production (fail fast, not fail insecurely);
 * in development/test, fall back to a clearly-labeled placeholder
 * (with a loud warning) so `npm run dev` still works without
 * requiring secrets to be configured before the app can even boot.
 */
function requireSecret(name: string, isProduction: boolean): string {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value;
  }
  if (isProduction) {
    throw new Error(
      `Missing required environment variable "${name}" — refusing to start in production without it.`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[env] "${name}" is not set — using an insecure development-only placeholder. Set this in .env before deploying anywhere real.`,
  );
  return `dev-insecure-placeholder-${name.toLowerCase()}`;
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  /** e.g. "15m" — passed directly to jose's setExpirationTime(). */
  accessTokenExpiry: string;
  /** e.g. "30d" — passed directly to jose's setExpirationTime(). */
  refreshTokenExpiry: string;
  /** Same duration as refreshTokenExpiry, pre-converted to ms for the cookie's maxAge. */
  refreshTokenMaxAgeMs: number;
}

export interface RefreshCookieConfig {
  name: string;
  sameSite: SameSite;
}

/**
 * Unlike JWT secrets, there's no safe insecure fallback for a
 * database connection string — a placeholder value wouldn't let the
 * app "start but be insecure," it just wouldn't work at all. So this
 * is required in every environment, not just production.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value;
  }
  throw new Error(
    `Missing required environment variable "${name}" — the app cannot start without it.`,
  );
}

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  isProduction: boolean;
  redisUrl: string;
  databaseUrl: string;
  jwt: JwtConfig;
  refreshCookie: RefreshCookieConfig;
}

const nodeEnv = resolveNodeEnv(process.env["NODE_ENV"]);
const isProduction = nodeEnv === "production";
const refreshTokenExpiry = resolveDuration(
  process.env["JWT_REFRESH_EXPIRY"],
  "30d",
);

export const env: EnvConfig = {
  nodeEnv,
  port: resolvePort(process.env["PORT"]),
  isProduction,
  redisUrl: resolveRedisUrl(process.env["REDIS_URL"]),
  databaseUrl: requireEnv("DATABASE_URL"),
  jwt: {
    accessSecret: requireSecret("JWT_ACCESS_SECRET", isProduction),
    refreshSecret: requireSecret("JWT_REFRESH_SECRET", isProduction),
    accessTokenExpiry: resolveDuration(process.env["JWT_ACCESS_EXPIRY"], "15m"),
    refreshTokenExpiry,
    refreshTokenMaxAgeMs: parseDurationMs(refreshTokenExpiry),
  },
  refreshCookie: {
    name:
      process.env["REFRESH_TOKEN_COOKIE_NAME"]?.trim() ||
      "agencyops_refresh_token",
    sameSite: resolveSameSite(process.env["REFRESH_TOKEN_COOKIE_SAME_SITE"]),
  },
};
