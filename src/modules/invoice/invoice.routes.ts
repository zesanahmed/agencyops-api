import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { create, getOne, list, send, update, voidOne } from "./invoice.controller.js";
import {
  createInvoiceSchema,
  invoiceIdParamSchema,
  invoiceListQuerySchema,
  updateInvoiceSchema,
} from "./invoice.validation.js";

/** Client invoices (an agency billing its clients), mounted at /organizations/:organizationId/invoices. */
const invoiceRouter: Router = Router({ mergeParams: true });

invoiceRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

const byId = validate({ params: organizationIdParamSchema.merge(invoiceIdParamSchema) });

invoiceRouter.post("/", requirePermission("invoice:manage"), validate({ body: createInvoiceSchema }), create);
invoiceRouter.get("/", requirePermission("invoice:read"), validate({ query: invoiceListQuerySchema }), list);
invoiceRouter.get("/:invoiceId", requirePermission("invoice:read"), byId, getOne);
invoiceRouter.patch("/:invoiceId", requirePermission("invoice:manage"), byId, validate({ body: updateInvoiceSchema }), update);
invoiceRouter.post("/:invoiceId/send", requirePermission("invoice:manage"), byId, send);
invoiceRouter.post("/:invoiceId/void", requirePermission("invoice:manage"), byId, voidOne);

export { invoiceRouter };
