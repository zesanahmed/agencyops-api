import type { MembershipRole } from "../../generated/prisma/client.js";

export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "organization:delete",
  "membership:read",
  "membership:update",
  "membership:remove",
  "invitation:create",
  "invitation:read",
  "invitation:revoke",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  OWNER: [
    "organization:read",
    "organization:update",
    "organization:delete",
    "membership:read",
    "membership:update",
    "membership:remove",
    "invitation:create",
    "invitation:read",
    "invitation:revoke",
  ],
  MANAGER: [
    "organization:read",
    "membership:read",
    "invitation:create",
    "invitation:read",
    "invitation:revoke",
  ],
  TEAM_MEMBER: ["organization:read", "membership:read"],
};

export function roleHasPermission(
  role: MembershipRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
