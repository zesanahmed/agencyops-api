import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema, paginationQuerySchema } from "../organization/organization.validation.js";
import { create, list, remove, update } from "./comment.controller.js";
import { commentIdParamSchema, createCommentSchema, updateCommentSchema } from "./comment.validation.js";

const commentRouter: Router = Router({ mergeParams: true });

commentRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

commentRouter.post("/", validate({ body: createCommentSchema }), requirePermission("comment:create"), create);
commentRouter.get("/", validate({ query: paginationQuerySchema }), requirePermission("comment:read"), list);
commentRouter.patch(
  "/:commentId",
  validate({ params: commentIdParamSchema, body: updateCommentSchema }),
  requirePermission("comment:create"),
  update,
);
commentRouter.delete(
  "/:commentId",
  validate({ params: commentIdParamSchema }),
  requirePermission("comment:create"),
  remove,
);

export { commentRouter };
