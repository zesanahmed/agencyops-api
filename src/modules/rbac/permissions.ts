import type { MembershipRole } from "../../generated/prisma/client.js";

/**
 * Every permission the app currently knows about. Deliberately a
 * flat list of `resource:action` strings rather than a class
 * hierarchy or dynamic builder — new modules (team, project, task,
 * ...) add their own entries here as they're introduced, they don't
 * need a new mechanism.
 */
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
  "team:create",
  "team:read",
  "team:update",
  "team:delete",
  "team:manage-members",
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "project:manage-teams",
  "project:manage-members",
  "sprint:create",
  "sprint:read",
  "sprint:update",
  "sprint:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Static role → permission matrix. "Static" is the point: this is a
 * plain lookup table, not a rules engine. A role's permissions are
 * exactly the array listed here — no inheritance, no wildcards, no
 * per-organization overrides. If that's ever needed, it's a
 * deliberate future change to this file, not something the current
 * shape tries to anticipate.
 */
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
    "team:create",
    "team:read",
    "team:update",
    "team:delete",
    "team:manage-members",
    "project:create",
    "project:read",
    "project:update",
    "project:delete",
    "project:manage-teams",
    "project:manage-members",
    "sprint:create",
    "sprint:read",
    "sprint:update",
    "sprint:delete",
  ],
  MANAGER: [
    "organization:read",
    "membership:read",
    "invitation:create",
    "invitation:read",
    "invitation:revoke",
    "team:create",
    "team:read",
    "team:update",
    "team:delete",
    "team:manage-members",
    "project:create",
    "project:read",
    "project:update",
    "project:delete",
    "project:manage-teams",
    "project:manage-members",
    "sprint:create",
    "sprint:read",
    "sprint:update",
    "sprint:delete",
  ],
  TEAM_MEMBER: ["organization:read", "membership:read", "team:read", "project:read", "sprint:read"],
};

export function roleHasPermission(
  role: MembershipRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
