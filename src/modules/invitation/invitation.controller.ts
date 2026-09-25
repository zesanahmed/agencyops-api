import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import { getCurrentUser } from "../auth/auth.service.js";
import type { PaginationQuery } from "../organization/organization.validation.js";
import {
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
  listInvitations,
  revokeInvitation,
} from "./invitation.service.js";
import type {
  CreateInvitationBody,
  InvitationTokenParams,
} from "./invitation.validation.js";

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateInvitationBody;
  const organizationId = req.orgContext!.organization.id;
  const invitedByMembershipId = req.orgContext!.membership.id;

  const result = await createInvitation({
    organizationId,
    email: body.email,
    role: body.role,
    invitedByMembershipId,
  });

  sendSuccess(
    res,
    { invitation: result.invitation, inviteToken: result.rawToken },
    "Invitation created successfully",
    201,
  );
}

export async function list(req: Request, res: Response): Promise<void> {
  const organizationId = req.orgContext!.organization.id;
  const { page, limit } = req.query as unknown as PaginationQuery;

  const result = await listInvitations({ organizationId, page, limit });

  sendSuccess(
    res,
    { invitations: result.invitations, pagination: result.pagination },
    "Invitations retrieved successfully",
  );
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const { invitationId } = req.params as { invitationId: string };
  await revokeInvitation(req.orgContext!.organization.id, invitationId);
  sendSuccess(res, null, "Invitation revoked successfully");
}

export async function preview(req: Request, res: Response): Promise<void> {
  const { token } = req.params as InvitationTokenParams;
  const result = await getInvitationPreview(token);
  sendSuccess(res, { invitation: result }, "Invitation retrieved successfully");
}

export async function accept(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    throw new AppError("Authentication required", 401);
  }
  const { token } = req.params as InvitationTokenParams;

  const currentUser = await getCurrentUser(req.auth.userId);

  await acceptInvitation({
    rawToken: token,
    userId: req.auth.userId,
    userEmail: currentUser.email,
  });

  sendSuccess(res, null, "Invitation accepted successfully");
}
