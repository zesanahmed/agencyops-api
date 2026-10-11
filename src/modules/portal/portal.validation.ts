import { z } from "zod";
import { passwordSchema } from "../auth/auth.validation.js";

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(16).max(256),
  password: passwordSchema,
});

export const clientLoginSchema = z.object({
  organizationSlug: z.string().trim().toLowerCase().min(1).max(150),
  email: z.string().trim().email("Enter a valid email address").max(254),
  // Presence only, same reasoning as internal login: a password-policy
  // change must not lock out existing contacts.
  password: z.string().min(1, "Password is required"),
});

export type AcceptInviteBody = z.infer<typeof acceptInviteSchema>;
export type ClientLoginBody = z.infer<typeof clientLoginSchema>;
