import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import { toSafeOrganization } from "./organization.mappers.js";
import {
  createOrganization,
  deleteOrganization,
  listUserOrganizations,
  updateOrganization,
} from "./organization.service.js";
import type {
  CreateOrganizationBody,
  PaginationQuery,
  UpdateOrganizationBody,
} from "./organization.validation.js";

/**
 * POST /api/v1/organizations
 * ownerId is always the authenticated user — never taken from the
 * request body, so a client can't create an organization owned by
 * someone else.
 */
export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateOrganizationBody;
  const ownerId = req.auth!.userId;

  const result = await createOrganization({
    name: body.name,
    ownerId,
    ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
  });

  sendSuccess(
    res,
    { organization: result.organization, membership: result.membership },
    "Organization created successfully",
    201,
  );
}

/**
 * GET /api/v1/organizations
 * Only organizations the authenticated user has an active
 * Membership in — see listUserOrganizations()'s doc comment.
 */
export async function list(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as unknown as PaginationQuery;
  const userId = req.auth!.userId;

  const result = await listUserOrganizations({ userId, page, limit });

  sendSuccess(
    res,
    { organizations: result.organizations, pagination: result.pagination },
    "Organizations retrieved successfully",
  );
}

/**
 * GET /api/v1/organizations/:organizationId
 * The organization was already loaded and permission-checked by
 * loadOrganizationContext + requirePermission("organization:read")
 * (see organization.routes.ts) — this handler only shapes the
 * response.
 */
export async function getOne(req: Request, res: Response): Promise<void> {
  const organization = toSafeOrganization(req.orgContext!.organization);
  sendSuccess(res, { organization }, "Organization retrieved successfully");
}

/**
 * PATCH /api/v1/organizations/:organizationId
 * Reaches here only for OWNER (requirePermission("organization:update")).
 */
export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateOrganizationBody;
  const organization = await updateOrganization(
    req.orgContext!.organization.id,
    body,
  );
  sendSuccess(res, { organization }, "Organization updated successfully");
}

/**
 * DELETE /api/v1/organizations/:organizationId
 * Reaches here only for OWNER (requirePermission("organization:delete")).
 * Soft-delete only — see deleteOrganization().
 */
export async function remove(req: Request, res: Response): Promise<void> {
  await deleteOrganization(req.orgContext!.organization.id);
  sendSuccess(res, null, "Organization deleted successfully");
}
