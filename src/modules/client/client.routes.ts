import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import {
  create,
  createContactHandler,
  disable,
  enable,
  getOne,
  grantAccessHandler,
  linkProjectHandler,
  list,
  listAccessHandler,
  listContactsHandler,
  listProjectsHandler,
  reinvite,
  remove,
  revokeAccessHandler,
  unlinkProjectHandler,
  update,
  updateContactHandler,
} from "./client.controller.js";
import {
  clientIdParamSchema,
  clientListQuerySchema,
  contactIdParamSchema,
  createClientSchema,
  createContactSchema,
  grantAccessSchema,
  linkProjectSchema,
  projectIdParamSchema,
  updateClientSchema,
  updateContactSchema,
} from "./client.validation.js";

const clientRouter: Router = Router({ mergeParams: true });

clientRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

const clientId = validate({ params: clientIdParamSchema });
const contactParams = validate({ params: clientIdParamSchema.merge(contactIdParamSchema) });

// Client organizations
clientRouter.post("/", validate({ body: createClientSchema }), requirePermission("client:create"), create);
clientRouter.get("/", validate({ query: clientListQuerySchema }), requirePermission("client:read"), list);
clientRouter.get("/:clientId", clientId, requirePermission("client:read"), getOne);
clientRouter.patch(
  "/:clientId",
  validate({ params: clientIdParamSchema, body: updateClientSchema }),
  requirePermission("client:update"),
  update,
);
clientRouter.delete("/:clientId", clientId, requirePermission("client:delete"), remove);

// Contacts
clientRouter.post(
  "/:clientId/contacts",
  validate({ params: clientIdParamSchema, body: createContactSchema }),
  requirePermission("client:create"),
  createContactHandler,
);
clientRouter.get("/:clientId/contacts", clientId, requirePermission("client:read"), listContactsHandler);
clientRouter.patch(
  "/:clientId/contacts/:contactId",
  validate({ params: clientIdParamSchema.merge(contactIdParamSchema), body: updateContactSchema }),
  requirePermission("client:update"),
  updateContactHandler,
);
clientRouter.post("/:clientId/contacts/:contactId/reinvite", contactParams, requirePermission("client:update"), reinvite);
clientRouter.post("/:clientId/contacts/:contactId/enable", contactParams, requirePermission("client:update"), enable);
clientRouter.delete("/:clientId/contacts/:contactId", contactParams, requirePermission("client:update"), disable);

// Project <-> client linkage
clientRouter.get("/:clientId/projects", clientId, requirePermission("client:read"), listProjectsHandler);
clientRouter.post(
  "/:clientId/projects",
  validate({ params: clientIdParamSchema, body: linkProjectSchema }),
  requirePermission("client:manage-access"),
  linkProjectHandler,
);
clientRouter.delete(
  "/:clientId/projects/:projectId",
  validate({ params: clientIdParamSchema.merge(projectIdParamSchema) }),
  requirePermission("client:manage-access"),
  unlinkProjectHandler,
);

// Explicit contact -> project access
clientRouter.get("/:clientId/contacts/:contactId/access", contactParams, requirePermission("client:read"), listAccessHandler);
clientRouter.post(
  "/:clientId/contacts/:contactId/access",
  validate({ params: clientIdParamSchema.merge(contactIdParamSchema), body: grantAccessSchema }),
  requirePermission("client:manage-access"),
  grantAccessHandler,
);
clientRouter.delete(
  "/:clientId/contacts/:contactId/access/:projectId",
  validate({ params: clientIdParamSchema.merge(contactIdParamSchema).merge(projectIdParamSchema) }),
  requirePermission("client:manage-access"),
  revokeAccessHandler,
);

export { clientRouter };
