import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * bcrypt cost factor (2^12 rounds). Kept as a single tuning point so it
 * can be revisited without touching call sites. `bcryptjs` is pure
 * JavaScript on purpose: no native `.node` binary, so it also loads on
 * machines whose application-control policy blocks unsigned native
 * modules (e.g. Windows Smart App Control).
 *
 * bcrypt only uses the first 72 bytes of a password; passwordSchema
 * rejects anything longer so nothing is silently truncated.
 */
const BCRYPT_COST = 12;

/**
 * Hashes a plaintext password. The returned string is
 * self-describing (algorithm, cost and salt are encoded in it), so
 * comparePassword() doesn't need the cost passed back in.
 *
 * Callers never touch the hashing package directly — everything
 * password-related goes through hashPassword/comparePassword, so the
 * algorithm stays replaceable behind this one file.
 *
 * Never logs the password or the resulting hash.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Compares a plaintext password against a stored hash. Never logs
 * either argument.
 */
export async function comparePassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Hashes a refresh token for storage in Session.refreshTokenHash.
 * Deliberately NOT bcrypt — that's a slow algorithm
 * designed for low-entropy human-chosen passwords, where the whole
 * point is making brute-force guessing expensive. A refresh token
 * is already a high-entropy, randomly-generated secret (a signed
 * JWT), so a fast cryptographic digest is the correct, standard
 * choice — using bcrypt here would just add latency for no real
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
