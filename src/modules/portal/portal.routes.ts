import { Router } from "express";
import { uploadSingleFile } from "../../middlewares/upload.js";
import { authRateLimiter, refreshRateLimiter } from "../../middlewares/rateLimit.js";
import { validate } from "../../middlewares/validate.js";
import {
  portalCreateRequest,
  portalGetProject,
  portalListFiles,
  portalListMessages,
  portalListProjects,
  portalListRequests,
  portalListTasks,
  portalListUpdates,
  portalPostMessage,
  portalUploadFile,
} from "../client-collaboration/collaboration.controller.js";
import {
  createClientRequestSchema,
  createMessageSchema,
  paginationSchema,
  portalTaskQuerySchema,
  projectIdParamSchema,
} from "../client-collaboration/collaboration.validation.js";
import { acceptInvite, login, logout, logoutAll, me, refresh } from "./portal.auth.controller.js";
import { portalAuthenticate, requireProjectAccess } from "./portal.middleware.js";
import { acceptInviteSchema, clientLoginSchema } from "./portal.validation.js";

/**
 * The client portal — a separate security boundary from the internal
 * API. Mounted at /api/v1/portal. Nothing here uses internal
 * authenticate/loadOrganizationContext/RBAC; every project-scoped route
 * requires an explicit ClientProjectAccess grant (requireProjectAccess).
 */
const portalRouter: Router = Router();

// ---- Auth ----
portalRouter.post("/auth/accept-invite", authRateLimiter, validate({ body: acceptInviteSchema }), acceptInvite);
portalRouter.post("/auth/login", authRateLimiter, validate({ body: clientLoginSchema }), login);
portalRouter.post("/auth/refresh", refreshRateLimiter, refresh);
portalRouter.post("/auth/logout", logout);
portalRouter.post("/auth/logout-all", portalAuthenticate, logoutAll);
portalRouter.get("/auth/me", portalAuthenticate, me);

// ---- Everything below requires a valid, live client session ----
portalRouter.use(portalAuthenticate);

portalRouter.get("/projects", portalListProjects);

const projectScope = [validate({ params: projectIdParamSchema }), requireProjectAccess] as const;
const paged = validate({ query: paginationSchema });

portalRouter.get("/projects/:projectId", ...projectScope, portalGetProject);
portalRouter.get("/projects/:projectId/tasks", ...projectScope, validate({ query: portalTaskQuerySchema }), portalListTasks);
portalRouter.get("/projects/:projectId/updates", ...projectScope, paged, portalListUpdates);

portalRouter.get("/projects/:projectId/messages", ...projectScope, paged, portalListMessages);
portalRouter.post(
  "/projects/:projectId/messages",
  ...projectScope,
  validate({ body: createMessageSchema }),
  portalPostMessage,
);

portalRouter.get("/projects/:projectId/requests", ...projectScope, paged, portalListRequests);
portalRouter.post(
  "/projects/:projectId/requests",
  ...projectScope,
  validate({ body: createClientRequestSchema }),
  portalCreateRequest,
);

portalRouter.get("/projects/:projectId/files", ...projectScope, paged, portalListFiles);
portalRouter.post("/projects/:projectId/files", ...projectScope, uploadSingleFile, portalUploadFile);

export { portalRouter };
