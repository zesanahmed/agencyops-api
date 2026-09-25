import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema, paginationQuerySchema } from "../organization/organization.validation.js";
import {
  addMember,
  create,
  getOne,
  list,
  listMembers,
  remove,
  removeMember,
  update,
} from "./team.controller.js";
import {
  addTeamMemberSchema,
  createTeamSchema,
  teamIdParamSchema,
  teamMemberIdParamSchema,
  updateTeamSchema,
} from "./team.validation.js";

const teamRouter: Router = Router({ mergeParams: true });

teamRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

teamRouter.post("/", validate({ body: createTeamSchema }), requirePermission("team:create"), create);
teamRouter.get("/", validate({ query: paginationQuerySchema }), requirePermission("team:read"), list);
teamRouter.get("/:teamId", validate({ params: teamIdParamSchema }), requirePermission("team:read"), getOne);
teamRouter.patch("/:teamId", validate({ params: teamIdParamSchema, body: updateTeamSchema }), requirePermission("team:update"), update);
teamRouter.delete("/:teamId", validate({ params: teamIdParamSchema }), requirePermission("team:delete"), remove);

teamRouter.get("/:teamId/members", validate({ params: teamIdParamSchema }), requirePermission("team:read"), listMembers);
teamRouter.post(
  "/:teamId/members",
  validate({ params: teamIdParamSchema, body: addTeamMemberSchema }),
  requirePermission("team:manage-members"),
  addMember,
);
teamRouter.delete(
  "/:teamId/members/:teamMemberId",
  validate({ params: teamIdParamSchema.merge(teamMemberIdParamSchema) }),
  requirePermission("team:manage-members"),
  removeMember,
);

export { teamRouter };
