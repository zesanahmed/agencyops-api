import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { MembershipRole } from "../../generated/prisma/client.js";
import {
  toSafeMembership,
  type SafeMembership,
} from "./organization.mappers.js";

const MEMBER_NOT_FOUND_MESSAGE = "Membership not found";

const memberSelectInclude = {
  user: {
    select: { id: true, name: true, email: true, avatarUrl: true },
  },
} as const;

/**
 * Explicit payload type for every query below that uses
 * memberSelectInclude. Needed because at least one of Prisma's
 * findMany overloads wasn't resolving cleanly against this
 * where+include combination and silently fell back to `any` (only
 * surfaced by the compiler where the result hit a noImplicitAny
 * callback parameter) — annotating the variable directly forces a
 * real structural check instead of relying on inference here.
 */
type MembershipWithUser = Prisma.MembershipGetPayload<{
  include: typeof memberSelectInclude;
}>;

/**
 * Fetches an ACTIVE membership scoped to a specific organization.
 * Every membership-mutating function below goes through this rather
 * than a bare `findUnique({ where: { id } })` — filtering on
 * `organizationId` too is what prevents a membershipId that exists
 * in a *different* organization from being read or modified via
 * this org's URL (cross-tenant isolation, requirement: "A user
 * cannot access membership records belonging to another
 * organization").
 */
async function findActiveMembership(
  organizationId: string,
  membershipId: string,
): Promise<MembershipWithUser | null> {
  return prisma.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE" },
    include: memberSelectInclude,
  });
}

async function countActiveOwners(organizationId: string): Promise<number> {
  return prisma.membership.count({
    where: { organizationId, role: "OWNER", status: "ACTIVE" },
  });
}

export interface ListMembersInput {
  organizationId: string;
  page: number;
  limit: number;
}

export interface ListMembersResult {
  members: SafeMembership[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function listMembers(
  input: ListMembersInput,
): Promise<ListMembersResult> {
  const where = {
    organizationId: input.organizationId,
    status: "ACTIVE" as const,
  };

  const memberships: MembershipWithUser[] = await prisma.membership.findMany({
    where,
    include: memberSelectInclude,
    orderBy: { joinedAt: "asc" },
    skip: (input.page - 1) * input.limit,
    take: input.limit,
  });
  const total = await prisma.membership.count({ where });

  return {
    members: memberships.map((m) => toSafeMembership(m, m.user)),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

export async function getMember(
  organizationId: string,
  membershipId: string,
): Promise<SafeMembership> {
  const membership = await findActiveMembership(organizationId, membershipId);
  if (!membership) {
    throw new AppError(MEMBER_NOT_FOUND_MESSAGE, 404);
  }
  return toSafeMembership(membership, membership.user);
}

/**
 * Changes a member's role. `newRole` is already constrained to
 * MANAGER/TEAM_MEMBER by updateMembershipRoleSchema — OWNER is not
 * an accepted value here at all, so this function never needs to
 * reject "promote to OWNER" itself.
 *
 * What it does guard: demoting the organization's only remaining
 * OWNER, which would leave the organization with no owner at all.
 */
export async function updateMemberRole(
  organizationId: string,
  membershipId: string,
  newRole: Extract<MembershipRole, "MANAGER" | "TEAM_MEMBER">,
): Promise<SafeMembership> {
  const membership = await findActiveMembership(organizationId, membershipId);
  if (!membership) {
    throw new AppError(MEMBER_NOT_FOUND_MESSAGE, 404);
  }

  if (membership.role === "OWNER") {
    const ownerCount = await countActiveOwners(organizationId);
    if (ownerCount <= 1) {
      throw new AppError(
        "Cannot change the role of the organization's only owner",
        409,
      );
    }
  }

  const updated: MembershipWithUser = await prisma.membership.update({
    where: { id: membershipId },
    data: { role: newRole },
    include: memberSelectInclude,
  });

  return toSafeMembership(updated, updated.user);
}

/**
 * Removes a member (soft — `status: REMOVED` + `removedAt`, never a
 * physical delete). Because every org-scoped route re-checks
 * `status: "ACTIVE"` on every request (see loadOrganizationContext
 * in rbac.middleware.ts), a removed member loses access on their
 * very next request — there's no separate "revoke access" step
 * needed here.
 *
 * Same only-owner protection as updateMemberRole above.
 */
export async function removeMember(
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const membership = await findActiveMembership(organizationId, membershipId);
  if (!membership) {
    throw new AppError(MEMBER_NOT_FOUND_MESSAGE, 404);
  }

  if (membership.role === "OWNER") {
    const ownerCount = await countActiveOwners(organizationId);
    if (ownerCount <= 1) {
      throw new AppError("Cannot remove the organization's only owner", 409);
    }
  }

  await prisma.membership.update({
    where: { id: membershipId },
    data: { status: "REMOVED", removedAt: new Date() },
  });
}
