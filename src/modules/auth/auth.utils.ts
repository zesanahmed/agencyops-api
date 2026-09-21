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
 * Intentionally the only two exports of this module (see
 * comparePassword below) — callers never touch the `argon2` package
 * directly, so the hashing algorithm stays replaceable behind this
 * one file if it's ever changed later.
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
