import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authenticate } from "../auth/auth.middleware.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { create, getOne, list, remove, update } from "./organization.controller.js";
import { membershipRouter } from "./membership.routes.js";
import {
  createOrganizationSchema,
  organizationIdParamSchema,
  paginationQuerySchema,
  updateOrganizationSchema,
} from "./organization.validation.js";

const organizationRouter: Router = Router();

// Every organization route requires authentication.
organizationRouter.use(authenticate);

organizationRouter.post(
  "/",
  validate({ body: createOrganizationSchema }),
  create,
);

organizationRouter.get(
  "/",
  validate({ query: paginationQuerySchema }),
  list,
);

organizationRouter.get(
  "/:organizationId",
  validate({ params: organizationIdParamSchema }),
  loadOrganizationContext(),
  requirePermission("organization:read"),
  getOne,
);

organizationRouter.patch(
  "/:organizationId",
  validate({
    params: organizationIdParamSchema,
    body: updateOrganizationSchema,
  }),
  loadOrganizationContext(),
  requirePermission("organization:update"),
  update,
);

organizationRouter.delete(
  "/:organizationId",
  validate({ params: organizationIdParamSchema }),
  loadOrganizationContext(),
  requirePermission("organization:delete"),
  remove,
);

// Membership routes live under this organization's own path — see
// membership.routes.ts. Mounted last so the more specific
// "/:organizationId" routes above aren't shadowed by it.
organizationRouter.use("/:organizationId/members", membershipRouter);

export { organizationRouter };
