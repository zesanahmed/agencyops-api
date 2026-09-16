/**
 * Centralized environment configuration.
 *
 * Business modules should import `env` from here instead of
 * reading `process.env` directly, so environment access stays
 * in one place as more variables (DB, Redis, OAuth, etc.) are
 * introduced in later stages.
 *
 * No .env file loading yet (nothing sensitive to load) — a
 * loader such as dotenv can be added once real secrets
 * (database URL, OAuth credentials, etc.) are introduced.
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

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  isProduction: boolean;
}

const nodeEnv = resolveNodeEnv(process.env["NODE_ENV"]);

export const env: EnvConfig = {
  nodeEnv,
  port: resolvePort(process.env["PORT"]),
  isProduction: nodeEnv === "production",
};
