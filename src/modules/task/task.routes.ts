import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { commentRouter } from "../comment/comment.routes.js";
import {
  addCollaboratorHandler,
  create,
  createSubtaskHandler,
  getOne,
  list,
  listCollaboratorsHandler,
  listSubtasksHandler,
  remove,
  removeCollaboratorHandler,
  update,
} from "./task.controller.js";
import {
  addCollaboratorSchema,
  createSubtaskSchema,
  createTaskSchema,
  taskCollaboratorIdParamSchema,
  taskIdParamSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from "./task.validation.js";

const taskRouter: Router = Router({ mergeParams: true });

taskRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

taskRouter.post("/", validate({ body: createTaskSchema }), requirePermission("task:create"), create);
taskRouter.get("/", validate({ query: taskListQuerySchema }), requirePermission("task:read"), list);
taskRouter.get("/:taskId", validate({ params: taskIdParamSchema }), requirePermission("task:read"), getOne);
taskRouter.patch(
  "/:taskId",
  validate({ params: taskIdParamSchema, body: updateTaskSchema }),
  requirePermission("task:update"),
  update,
);
taskRouter.delete("/:taskId", validate({ params: taskIdParamSchema }), requirePermission("task:delete"), remove);

taskRouter.get("/:taskId/subtasks", validate({ params: taskIdParamSchema }), requirePermission("task:read"), listSubtasksHandler);
taskRouter.post(
  "/:taskId/subtasks",
  validate({ params: taskIdParamSchema, body: createSubtaskSchema }),
  requirePermission("task:create"),
  createSubtaskHandler,
);

taskRouter.get(
  "/:taskId/collaborators",
  validate({ params: taskIdParamSchema }),
  requirePermission("task:read"),
  listCollaboratorsHandler,
);
taskRouter.post(
  "/:taskId/collaborators",
  validate({ params: taskIdParamSchema, body: addCollaboratorSchema }),
  requirePermission("task:update"),
  addCollaboratorHandler,
);
taskRouter.delete(
  "/:taskId/collaborators/:taskCollaboratorId",
  validate({ params: taskIdParamSchema.merge(taskCollaboratorIdParamSchema) }),
  requirePermission("task:update"),
  removeCollaboratorHandler,
);

taskRouter.use("/:taskId/comments", commentRouter);

export { taskRouter };
