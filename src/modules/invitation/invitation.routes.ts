import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import {
  loadOrganizationContext,
  requirePermission,
} from "../rbac/rbac.middleware.js";
import {
  organizationIdParamSchema,
  paginationQuerySchema,
} from "../organization/organization.validation.js";
import { create, list, revoke } from "./invitation.controller.js";
import {
  createInvitationSchema,
  invitationIdParamSchema,
} from "./invitation.validation.js";

const invitationRouter: Router = Router({ mergeParams: true });

invitationRouter.use(
  validate({ params: organizationIdParamSchema }),
  loadOrganizationContext(),
);

invitationRouter.post(
  "/",
  validate({ body: createInvitationSchema }),
  requirePermission("invitation:create"),
  create,
);

invitationRouter.get(
  "/",
  validate({ query: paginationQuerySchema }),
  requirePermission("invitation:read"),
  list,
);

invitationRouter.delete(
  "/:invitationId",
  validate({ params: invitationIdParamSchema }),
  requirePermission("invitation:revoke"),
  revoke,
);

export { invitationRouter };
