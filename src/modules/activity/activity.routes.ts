import { Router } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import { validate } from "../../middlewares/validate.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { getProjectIdsForMembership } from "../project/project.access.js";
import { roleHasPermission } from "../rbac/permissions.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { listActivity, type ActivityListQuery } from "./activity.service.js";
import { activityListQuerySchema } from "./activity.validation.js";

const activityRouter: Router = Router({ mergeParams: true });

activityRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

/**
 * OWNER/MANAGER (`activity:read-all`) see the whole organization's feed; everyone else only
 * sees entries of projects they belong to (explicit member or via an assigned team).
 */
activityRouter.get("/", validate({ query: activityListQuerySchema }), requirePermission("activity:read"), async (req, res) => {
  const { organization, membership } = req.orgContext!;
  const query = req.query as unknown as ActivityListQuery;
  const visible = roleHasPermission(membership.role, "activity:read-all")
    ? null
    : await getProjectIdsForMembership(organization.id, membership.id);
  const result = await listActivity(organization.id, query, visible);
  sendSuccess(res, result, "Activity retrieved successfully");
});

export { activityRouter };
