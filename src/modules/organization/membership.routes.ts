import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authenticate } from "../auth/auth.middleware.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { getOne, list, remove, updateRole } from "./membership.controller.js";
import {
  membershipIdParamSchema,
  updateMembershipRoleSchema,
} from "./membership.validation.js";
import {
  organizationIdParamSchema,
  paginationQuerySchema,
} from "./organization.validation.js";

// mergeParams: true — this router is mounted at
// "/organizations/:organizationId/members" in organization.routes.ts,
// and needs :organizationId from the parent path in its own req.params.
const membershipRouter: Router = Router({ mergeParams: true });

membershipRouter.use(
  authenticate,
  validate({ params: organizationIdParamSchema }),
  loadOrganizationContext(),
);

membershipRouter.get(
  "/",
  validate({ query: paginationQuerySchema }),
  requirePermission("membership:read"),
  list,
);

membershipRouter.get(
  "/:membershipId",
  validate({ params: membershipIdParamSchema }),
  requirePermission("membership:read"),
  getOne,
);

membershipRouter.patch(
  "/:membershipId/role",
  validate({
    params: membershipIdParamSchema,
    body: updateMembershipRoleSchema,
  }),
  requirePermission("membership:update"),
  updateRole,
);

membershipRouter.delete(
  "/:membershipId",
  validate({ params: membershipIdParamSchema }),
  requirePermission("membership:remove"),
  remove,
);

export { membershipRouter };
