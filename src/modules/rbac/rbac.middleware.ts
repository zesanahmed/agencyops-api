import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { Permission } from "./permissions.js";
import { roleHasPermission } from "./permissions.js";
import "./rbac.types.js";

const ORGANIZATION_NOT_FOUND_MESSAGE = "Organization not found";

/**
 * Loads and verifies the caller's organization context for the
 * current request. Must run after `authenticate` (needs req.auth)
 * and is the mandatory first step for every org-scoped route:
 *
 *   authenticate → loadOrganizationContext → requirePermission(...) → handler
 *
 * Deliberately re-checks the database on every request rather than
 * trusting anything from the URL or a token — organizationId is
 * client-supplied and membership can change (removal, suspension)
 * between requests, so there is nothing safe to cache here.
 *
 * A user who isn't an active member of the organization gets the
 * same 404 as an organization that doesn't exist at all — this
 * avoids confirming an organization's existence to someone who
 * isn't part of it, matching the enumeration-avoidance approach
 * already used elsewhere in this app (see auth.service.ts's generic
 * login/refresh error messages).
 *
 * A suspended or soft-deleted organization is rejected for every
 * member, including its OWNER — "prevent access to
 * suspended/deleted organizations" applies regardless of role.
 */
export function loadOrganizationContext() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const { organizationId } = req.params as { organizationId: string };
    const userId = req.auth!.userId;

    const membership = await prisma.membership.findFirst({
      where: { organizationId, userId, status: "ACTIVE" },
    });
    if (!membership) {
      throw new AppError(ORGANIZATION_NOT_FOUND_MESSAGE, 404);
    }

    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
    if (!organization) {
      throw new AppError(ORGANIZATION_NOT_FOUND_MESSAGE, 404);
    }
    if (organization.status === "SUSPENDED") {
      throw new AppError("This organization is suspended", 403);
    }

    req.orgContext = { organization, membership };
    next();
  };
}

/**
 * Checks the caller's role (from req.orgContext, set by
 * loadOrganizationContext above) against the static permission
 * matrix. Must run after loadOrganizationContext.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const membership = req.orgContext?.membership;
    if (!membership || !roleHasPermission(membership.role, permission)) {
      throw new AppError(
        "You do not have permission to perform this action",
        403,
      );
    }
    next();
  };
}
