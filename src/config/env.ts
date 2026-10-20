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

function resolveRedisUrl(value: string | undefined): string {
  if (value && value.trim() !== "") {
    return value;
  }
  return "redis://127.0.0.1:6379";
}

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value;
  }
  throw new Error(
    `Missing required environment variable "${name}" — the app cannot start without it.`,
  );
}

// Comma-separated list of allowed frontend origins. Defaults to
// common local dev ports when unset, EXCEPT in production, where an
// unset value means "no cross-origin requests allowed" rather than
// silently falling back to a permissive default.
/**
 * Express "trust proxy" setting. Behind a reverse proxy (Render, Vercel, nginx) every request
 * arrives from the proxy's IP unless this is set, which would make all users share one rate-limit
 * bucket. Defaults to off: trusting X-Forwarded-For without a proxy lets clients spoof their IP.
 * Accepts "true"/"false", a hop count ("1"), or an Express subnet/IP list string.
 */
function resolveTrustProxy(value: string | undefined): boolean | number | string {
  const v = value?.trim();
  if (!v || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function resolveCorsOrigins(value: string | undefined, isProduction: boolean): string[] {
  if (value && value.trim() !== "") {
    return value.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return isProduction ? [] : ["http://localhost:3000", "http://localhost:5173"];
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

// Optional, not required — unlike DATABASE_URL, file upload is one
// feature among many, not core to the app running at all. Missing
// Cloudinary config means the upload endpoints return a clear error
// when actually used, not that the whole app refuses to start.
function resolveCloudinaryConfig(): CloudinaryConfig | undefined {
  const cloudName = process.env["CLOUDINARY_CLOUD_NAME"];
  const apiKey = process.env["CLOUDINARY_API_KEY"];
  const apiSecret = process.env["CLOUDINARY_API_SECRET"];
  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }
  return undefined;
}

export interface StripeConfig {
  secretKey: string | undefined;
  webhookSecret: string | undefined;
  proPriceId: string | undefined;
}

// Optional, like Cloudinary: the app runs without Stripe; only the
// billing/payment endpoints return a clear 503 when it is not configured.
function resolveStripeConfig(): StripeConfig {
  const read = (name: string): string | undefined => {
    const value = process.env[name];
    return value && value.trim() !== "" ? value.trim() : undefined;
  };
  return {
    secretKey: read("STRIPE_SECRET_KEY"),
    webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
    proPriceId: read("STRIPE_PRO_PRICE_ID"),
  };
}

export interface EmailConfig {
  resendApiKey: string | undefined;
  from: string;
}

// Optional, like Stripe/Cloudinary. Without a key, emails are not sent: in
// development the worker just logs recipient + subject; in production the
// job fails loudly instead of silently dropping mail.
function resolveEmailConfig(): EmailConfig {
  const resendApiKey = process.env["RESEND_API_KEY"]?.trim();
  return {
    resendApiKey: resendApiKey ? resendApiKey : undefined,
    from: process.env["EMAIL_FROM"]?.trim() || "AgencyOps <onboarding@resend.dev>",
  };
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  /** Public base URL of THIS API; provider redirect URIs are built from it. */
  apiPublicUrl: string;
  google: OAuthProviderConfig | undefined;
  github: OAuthProviderConfig | undefined;
}

// Optional, like Stripe: a provider without credentials simply returns 503
// from its sign-in endpoint; password login is unaffected.
function resolveOAuthConfig(port: number): OAuthConfig {
  const read = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  };
  const provider = (prefix: string): OAuthProviderConfig | undefined => {
    const clientId = read(`${prefix}_CLIENT_ID`);
    const clientSecret = read(`${prefix}_CLIENT_SECRET`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  return {
    apiPublicUrl: (read("API_PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    google: provider("GOOGLE"),
    github: provider("GITHUB"),
  };
}

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  isProduction: boolean;
  redisUrl: string;
  databaseUrl: string;
  jwt: JwtConfig;
  refreshCookie: RefreshCookieConfig;
  corsOrigins: string[];
  trustProxy: boolean | number | string;
  cloudinary: CloudinaryConfig | undefined;
  stripe: StripeConfig;
  email: EmailConfig;
  oauth: OAuthConfig;
  /** Base URL of the web app, used to build Stripe checkout return URLs. */
  frontendUrl: string;
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
  corsOrigins: resolveCorsOrigins(process.env["CORS_ORIGIN"], isProduction),
  trustProxy: resolveTrustProxy(process.env["TRUST_PROXY"]),
  cloudinary: resolveCloudinaryConfig(),
  stripe: resolveStripeConfig(),
  email: resolveEmailConfig(),
  oauth: resolveOAuthConfig(resolvePort(process.env["PORT"])),
  frontendUrl: (process.env["FRONTEND_URL"]?.trim() || "http://localhost:3000").replace(/\/+$/, ""),
};
