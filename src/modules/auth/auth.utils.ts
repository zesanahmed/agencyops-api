import { createHash } from "node:crypto";
import argon2 from "argon2";

/**
 * OWASP's 2026 password-storage recommendation: Argon2id, with
 * memory/time/parallelism costs on the stronger end of OWASP's
 * suggested range (m=64MB, t=3, p=4). Kept as a single tuning point
 * so these can be revisited later without touching call sites.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} satisfies argon2.HashOptions;

/**
 * Hashes a plaintext password. The returned string is
 * self-describing (algorithm, version, and parameters are encoded
 * in it), so comparePassword() doesn't need ARGON2_OPTIONS passed
 * back in to verify it later.
 *
 * Callers never touch the `argon2` package directly — everything
 * password-related goes through hashPassword/comparePassword, so
 * the hashing algorithm stays replaceable behind this one file if
 * it's ever changed later.
 *
 * Never logs the password or the resulting hash.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Compares a plaintext password against a stored hash. Never logs
 * either argument.
 */
export async function comparePassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

/**
 * Hashes a refresh token for storage in Session.refreshTokenHash.
 * Deliberately NOT argon2 — that's a slow, memory-hard algorithm
 * designed for low-entropy human-chosen passwords, where the whole
 * point is making brute-force guessing expensive. A refresh token
 * is already a high-entropy, randomly-generated secret (a signed
 * JWT), so a fast cryptographic digest is the correct, standard
 * choice — using argon2 here would just add latency for no real
 * security benefit.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Normalizes an email address (trim + lowercase) so the same
 * address always maps to the same stored/queried value, regardless
 * of how a client happens to capitalize or space-pad it. Kept as
 * one explicit, reusable step — called deliberately in the service
 * layer, not hidden inside Zod validation — so normalization stays
 * visible and auditable rather than a silent transform.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
