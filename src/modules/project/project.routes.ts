import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { sprintRouter } from "../sprint/sprint.routes.js";
import {
  addMember,
  addTeam,
  create,
  getOne,
  list,
  listMembers,
  listTeams,
  remove,
  removeMember,
  removeTeam,
  update,
} from "./project.controller.js";
import {
  addProjectMemberSchema,
  assignProjectTeamSchema,
  createProjectSchema,
  projectIdParamSchema,
  projectListQuerySchema,
  projectMemberIdParamSchema,
  projectTeamIdParamSchema,
  updateProjectSchema,
} from "./project.validation.js";

const projectRouter: Router = Router({ mergeParams: true });

projectRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

projectRouter.post("/", validate({ body: createProjectSchema }), requirePermission("project:create"), create);
projectRouter.get("/", validate({ query: projectListQuerySchema }), requirePermission("project:read"), list);
projectRouter.get("/:projectId", validate({ params: projectIdParamSchema }), requirePermission("project:read"), getOne);
projectRouter.patch(
  "/:projectId",
  validate({ params: projectIdParamSchema, body: updateProjectSchema }),
  requirePermission("project:update"),
  update,
);
projectRouter.delete("/:projectId", validate({ params: projectIdParamSchema }), requirePermission("project:delete"), remove);

projectRouter.get("/:projectId/teams", validate({ params: projectIdParamSchema }), requirePermission("project:read"), listTeams);
projectRouter.post(
  "/:projectId/teams",
  validate({ params: projectIdParamSchema, body: assignProjectTeamSchema }),
  requirePermission("project:manage-teams"),
  addTeam,
);
projectRouter.delete(
  "/:projectId/teams/:projectTeamId",
  validate({ params: projectIdParamSchema.merge(projectTeamIdParamSchema) }),
  requirePermission("project:manage-teams"),
  removeTeam,
);

projectRouter.get("/:projectId/members", validate({ params: projectIdParamSchema }), requirePermission("project:read"), listMembers);
projectRouter.post(
  "/:projectId/members",
  validate({ params: projectIdParamSchema, body: addProjectMemberSchema }),
  requirePermission("project:manage-members"),
  addMember,
);
projectRouter.delete(
  "/:projectId/members/:projectMemberId",
  validate({ params: projectIdParamSchema.merge(projectMemberIdParamSchema) }),
  requirePermission("project:manage-members"),
  removeMember,
);

projectRouter.use("/:projectId/sprints", sprintRouter);

export { projectRouter };
