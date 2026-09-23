import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  getMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from "./membership.service.js";
import type { UpdateMembershipRoleBody } from "./membership.validation.js";
import type { PaginationQuery } from "./organization.validation.js";

/** GET /api/v1/organizations/:organizationId/members */
export async function list(req: Request, res: Response): Promise<void> {
  const organizationId = req.orgContext!.organization.id;
  const { page, limit } = req.query as unknown as PaginationQuery;

  const result = await listMembers({ organizationId, page, limit });

  sendSuccess(
    res,
    { members: result.members, pagination: result.pagination },
    "Members retrieved successfully",
  );
}

/** GET /api/v1/organizations/:organizationId/members/:membershipId */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { membershipId } = req.params as { membershipId: string };
  const member = await getMember(req.orgContext!.organization.id, membershipId);
  sendSuccess(res, { member }, "Member retrieved successfully");
}

/** PATCH /api/v1/organizations/:organizationId/members/:membershipId/role */
export async function updateRole(req: Request, res: Response): Promise<void> {
  const { membershipId } = req.params as { membershipId: string };
  const { role } = req.body as UpdateMembershipRoleBody;

  const member = await updateMemberRole(
    req.orgContext!.organization.id,
    membershipId,
    role,
  );

  sendSuccess(res, { member }, "Member role updated successfully");
}

/** DELETE /api/v1/organizations/:organizationId/members/:membershipId */
export async function remove(req: Request, res: Response): Promise<void> {
  const { membershipId } = req.params as { membershipId: string };
  await removeMember(req.orgContext!.organization.id, membershipId);
  sendSuccess(res, null, "Member removed successfully");
}
