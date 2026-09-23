import { z } from "zod";

export const membershipIdParamSchema = z.object({
  organizationId: z.string().uuid("Invalid organization id"),
  membershipId: z.string().uuid("Invalid membership id"),
});

/**
 * Deliberately excludes "OWNER" — this is the actual enforcement of
 * "do not allow assigning OWNER through the role-change endpoint".
 * OWNER can only ever be assigned at organization-creation time (see
 * organization.service.ts/createOrganization).
 */
export const updateMembershipRoleSchema = z.object({
  role: z.enum(["MANAGER", "TEAM_MEMBER"]),
});

export type MembershipIdParams = z.infer<typeof membershipIdParamSchema>;
export type UpdateMembershipRoleBody = z.infer<
  typeof updateMembershipRoleSchema
>;
