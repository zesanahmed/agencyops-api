import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema, paginationQuerySchema } from "../organization/organization.validation.js";
import { complete, create, getOne, list, remove, start, update } from "./sprint.controller.js";
import { createSprintSchema, sprintIdParamSchema, updateSprintSchema } from "./sprint.validation.js";

const sprintRouter: Router = Router({ mergeParams: true });

sprintRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

sprintRouter.post("/", validate({ body: createSprintSchema }), requirePermission("sprint:create"), create);
sprintRouter.get("/", validate({ query: paginationQuerySchema }), requirePermission("sprint:read"), list);
sprintRouter.get("/:sprintId", validate({ params: sprintIdParamSchema }), requirePermission("sprint:read"), getOne);
sprintRouter.patch(
  "/:sprintId",
  validate({ params: sprintIdParamSchema, body: updateSprintSchema }),
  requirePermission("sprint:update"),
  update,
);
sprintRouter.post("/:sprintId/start", validate({ params: sprintIdParamSchema }), requirePermission("sprint:update"), start);
sprintRouter.post("/:sprintId/complete", validate({ params: sprintIdParamSchema }), requirePermission("sprint:update"), complete);
sprintRouter.delete("/:sprintId", validate({ params: sprintIdParamSchema }), requirePermission("sprint:delete"), remove);

export { sprintRouter };
