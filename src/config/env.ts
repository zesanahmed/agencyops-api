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

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  isProduction: boolean;
  redisUrl: string;
}

const nodeEnv = resolveNodeEnv(process.env["NODE_ENV"]);

export const env: EnvConfig = {
  nodeEnv,
  port: resolvePort(process.env["PORT"]),
  isProduction: nodeEnv === "production",
  redisUrl: resolveRedisUrl(process.env["REDIS_URL"]),
};
