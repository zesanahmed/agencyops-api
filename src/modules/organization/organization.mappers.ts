import type {
  Membership,
  MembershipRole,
  MembershipStatus,
  Organization,
  OrganizationStatus,
} from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

/**
 * `[key: string]: JsonValue` (rather than a full closed interface)
 * is what lets these be passed straight into sendSuccess()'s
 * JsonValue-constrained `data` param — see the identical pattern
 * and reasoning on SafeUser in auth.service.ts. Every field here is
 * already a plain string/null/nested-object, so the index signature
 * doesn't widen what actually gets returned, it just satisfies the
 * structural check.
 */
export interface SafeOrganization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  ownerId: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export interface SafeMembershipUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  [key: string]: JsonValue;
}

export interface SafeMembership {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string;
  removedAt: string | null;
  /**
   * `null`, never omitted, when the caller didn't fetch the
   * membership with its user included — an optional (`user?:`)
   * field would make this index signature's value type
   * `JsonValue | undefined`, which JsonValue's own object variant
   * (`{ [key: string]: JsonValue }`) doesn't accept, breaking
   * assignability to sendSuccess()'s `data` param exactly the way
   * the comment on SafeUser (auth.service.ts) warns about.
   */
  user: SafeMembershipUser | null;
  [key: string]: JsonValue;
}

export function toSafeOrganization(organization: Organization): SafeOrganization {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logoUrl: organization.logoUrl,
    ownerId: organization.ownerId,
    status: organization.status,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

export function toSafeMembership(
  membership: Membership,
  user: SafeMembershipUser | null = null,
): SafeMembership {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    removedAt: membership.removedAt ? membership.removedAt.toISOString() : null,
    user,
  };
}
