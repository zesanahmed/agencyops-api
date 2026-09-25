import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long"),
  description: z.string().trim().max(2000).optional(),
});

export const updateTeamSchema = createTeamSchema.partial();

export const teamIdParamSchema = z.object({
  teamId: z.string().uuid("Invalid team id"),
});

export const addTeamMemberSchema = z.object({
  membershipId: z.string().uuid("Invalid membership id"),
});

export const teamMemberIdParamSchema = z.object({
  teamMemberId: z.string().uuid("Invalid team member id"),
});

export type CreateTeamBody = z.infer<typeof createTeamSchema>;
export type UpdateTeamBody = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberBody = z.infer<typeof addTeamMemberSchema>;
