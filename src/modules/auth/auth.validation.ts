import { z } from "zod";

/**
 * Password policy: length-focused rather than composition-focused.
 * Current guidance (NIST SP 800-63B) recommends against mandatory
 * character-class rules (must contain a symbol, etc.) — length is
 * the stronger lever, and composition rules mostly just push people
 * toward predictable substitutions. Minimum 8, generous but bounded
 * maximum (128) to keep pathologically long input from being fed
 * into Argon2 hashing.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

/**
 * Validation only — no .trim()/.toLowerCase() here. Normalization
 * (trimming the name, lowercasing the email) happens explicitly in
 * the service layer instead, so it stays a visible, separate step
 * rather than a transform hidden inside the schema.
 */
export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  email: z
    .string()
    .email("Enter a valid email address")
    .max(255, "Email is too long"),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  // Deliberately not re-validating the full password policy on
  // login — a policy change shouldn't retroactively lock out
  // existing users whose password predates it. Just require
  // presence.
  password: z.string().min(1, "Password is required"),
});

// Named "Body" (not "Input") specifically to avoid colliding with
// auth.service.ts's RegisterInput/LoginInput, which are the fuller
// service-layer shape (body + request metadata like userAgent/
// ipAddress). Structurally these would still work either way, but
// two same-named, differently-shaped types across files is a
// needless readability trap.
export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
