import { randomBytes } from "node:crypto";
import { hashToken } from "../auth/auth.utils.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { MembershipRole } from "../../generated/prisma/client.js";
import {
  toSafeInvitation,
  type InvitationPreview,
  type SafeInvitation,
} from "./invitation.mappers.js";

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ALREADY_MEMBER_MESSAGE =
  "This person is already a member of the organization";

const INVALID_INVITATION_MESSAGE =
  "This invitation is invalid or no longer available";

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: MembershipRole;
  invitedByMembershipId: string;
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: SafeInvitation; rawToken: string }> {
  const email = input.email.trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });
  if (existingUser) {
    const activeMembership = await prisma.membership.findFirst({
      where: {
        userId: existingUser.id,
        organizationId: input.organizationId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (activeMembership) {
      throw new AppError(ALREADY_MEMBER_MESSAGE, 409);
    }
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as Pick<typeof prisma, "invitation">;

    await txClient.invitation.updateMany({
      where: {
        organizationId: input.organizationId,
        email,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return txClient.invitation.create({
      data: {
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash,
        invitedByMembershipId: input.invitedByMembershipId,
        expiresAt,
      },
    });
  });

  return { invitation: toSafeInvitation(invitation), rawToken };
}

export interface ListInvitationsInput {
  organizationId: string;
  page: number;
  limit: number;
}

export interface ListInvitationsResult {
  invitations: SafeInvitation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function listInvitations(
  input: ListInvitationsInput,
): Promise<ListInvitationsResult> {
  const where = { organizationId: input.organizationId };

  const [invitations, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.invitation.count({ where }),
  ]);

  return {
    invitations: invitations.map(toSafeInvitation),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, organizationId },
  });
  if (!invitation) {
    throw new AppError("Invitation not found", 404);
  }
  if (invitation.acceptedAt !== null) {
    throw new AppError("This invitation has already been accepted", 409);
  }
  if (invitation.revokedAt !== null) {
    return; // already revoked — idempotent
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });
}

function isInvitationUsable(invitation: {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > Date.now()
  );
}

export async function getInvitationPreview(
  rawToken: string,
): Promise<InvitationPreview> {
  const invitation = await prisma.invitation.findFirst({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invitation || !isInvitationUsable(invitation)) {
    throw new AppError(INVALID_INVITATION_MESSAGE, 404);
  }

  return {
    organizationName: invitation.organization.name,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export interface AcceptInvitationInput {
  rawToken: string;
  userId: string;
  userEmail: string;
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: { tokenHash: hashToken(input.rawToken) },
  });

  if (!invitation || !isInvitationUsable(invitation)) {
    throw new AppError(INVALID_INVITATION_MESSAGE, 404);
  }

  if (invitation.email !== input.userEmail.trim().toLowerCase()) {
    throw new AppError(
      "This invitation was issued to a different email address",
      403,
    );
  }

  await prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as Pick<
      typeof prisma,
      "invitation" | "membership"
    >;

    const existingMembership = await txClient.membership.findFirst({
      where: {
        userId: input.userId,
        organizationId: invitation.organizationId,
      },
    });

    if (existingMembership) {
      if (existingMembership.status === "ACTIVE") {
        throw new AppError(ALREADY_MEMBER_MESSAGE, 409);
      }
      await txClient.membership.update({
        where: { id: existingMembership.id },
        data: {
          status: "ACTIVE",
          role: invitation.role,
          joinedAt: new Date(),
          removedAt: null,
        },
      });
    } else {
      await txClient.membership.create({
        data: {
          userId: input.userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
        },
      });
    }

    await txClient.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
  });
}
