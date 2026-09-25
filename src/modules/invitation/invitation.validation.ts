import { z } from "zod";

export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(255, "Email is too long"),
  role: z.enum(["MANAGER", "TEAM_MEMBER"]),
});

export const invitationIdParamSchema = z.object({
  invitationId: z.string().uuid("Invalid invitation id"),
});

export const invitationTokenParamSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
});

export type CreateInvitationBody = z.infer<typeof createInvitationSchema>;
export type InvitationIdParams = z.infer<typeof invitationIdParamSchema>;
export type InvitationTokenParams = z.infer<typeof invitationTokenParamSchema>;
