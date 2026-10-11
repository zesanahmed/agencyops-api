import { Router } from "express";
import { uploadSingleFile } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import {
  internalCreateUpdate,
  internalDeleteFile,
  internalDeleteMessage,
  internalDeleteUpdate,
  internalGetRequest,
  internalListFiles,
  internalListMessages,
  internalListRequests,
  internalListUpdates,
  internalPostMessage,
  internalSetTaskVisibility,
  internalUpdateRequest,
  internalUploadFile,
} from "./collaboration.controller.js";
import {
  createMessageSchema,
  createUpdateSchema,
  fileIdParamSchema,
  messageIdParamSchema,
  paginationSchema,
  projectIdParamSchema,
  requestIdParamSchema,
  requestListQuerySchema,
  setVisibilitySchema,
  taskIdParamSchema,
  updateClientRequestSchema,
  updateIdParamSchema,
} from "./collaboration.validation.js";

/**
 * Staff-side client collaboration, mounted at
 * /organizations/:organizationId/client-portal. Standard internal RBAC.
 */
const collaborationRouter: Router = Router({ mergeParams: true });

collaborationRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

const read = requirePermission("client-portal:read");
const manage = requirePermission("client-portal:manage");
const project = validate({ params: projectIdParamSchema });
const paged = validate({ query: paginationSchema });

// Requests (org-wide inbox)
collaborationRouter.get("/requests", validate({ query: requestListQuerySchema }), read, internalListRequests);
collaborationRouter.get("/requests/:requestId", validate({ params: requestIdParamSchema }), read, internalGetRequest);
collaborationRouter.patch(
  "/requests/:requestId",
  validate({ params: requestIdParamSchema, body: updateClientRequestSchema }),
  manage,
  internalUpdateRequest,
);

// Which tasks a client may see
collaborationRouter.patch(
  "/projects/:projectId/tasks/:taskId/visibility",
  validate({ params: projectIdParamSchema.merge(taskIdParamSchema), body: setVisibilitySchema }),
  manage,
  internalSetTaskVisibility,
);

// Updates
collaborationRouter.get("/projects/:projectId/updates", project, paged, read, internalListUpdates);
collaborationRouter.post(
  "/projects/:projectId/updates",
  validate({ params: projectIdParamSchema, body: createUpdateSchema }),
  manage,
  internalCreateUpdate,
);
collaborationRouter.delete(
  "/projects/:projectId/updates/:updateId",
  validate({ params: projectIdParamSchema.merge(updateIdParamSchema) }),
  manage,
  internalDeleteUpdate,
);

// Message thread
collaborationRouter.get("/projects/:projectId/messages", project, paged, read, internalListMessages);
collaborationRouter.post(
  "/projects/:projectId/messages",
  validate({ params: projectIdParamSchema, body: createMessageSchema }),
  manage,
  internalPostMessage,
);
collaborationRouter.delete(
  "/projects/:projectId/messages/:messageId",
  validate({ params: projectIdParamSchema.merge(messageIdParamSchema) }),
  manage,
  internalDeleteMessage,
);

// Shared files
collaborationRouter.get("/projects/:projectId/files", project, paged, read, internalListFiles);
collaborationRouter.post("/projects/:projectId/files", project, manage, uploadSingleFile, internalUploadFile);
collaborationRouter.delete(
  "/projects/:projectId/files/:fileId",
  validate({ params: projectIdParamSchema.merge(fileIdParamSchema) }),
  manage,
  internalDeleteFile,
);

export { collaborationRouter };
