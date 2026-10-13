import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { checkout, get, portal } from "./billing.controller.js";

/** Platform billing (an organization paying AgencyOps), mounted at /organizations/:organizationId/billing. */
const billingRouter: Router = Router({ mergeParams: true });

billingRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

billingRouter.get("/", requirePermission("billing:read"), get);
billingRouter.post("/checkout", requirePermission("billing:manage"), checkout);
billingRouter.post("/portal", requirePermission("billing:manage"), portal);

export { billingRouter };
