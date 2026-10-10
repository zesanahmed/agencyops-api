import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { uploadSingleFile } from "../../middlewares/upload.js";
import { loadOrganizationContext, requirePermission } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import { z } from "zod";
import { list, remove, upload } from "./attachment.controller.js";

const attachmentIdParamSchema = z.object({
  attachmentId: z.string().uuid("Invalid attachment id"),
});

const attachmentRouter: Router = Router({ mergeParams: true });

attachmentRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

attachmentRouter.get("/", requirePermission("task:read"), list);
attachmentRouter.post("/", requirePermission("task:update"), uploadSingleFile, upload);
attachmentRouter.delete(
  "/:attachmentId",
  validate({ params: attachmentIdParamSchema }),
  requirePermission("task:update"),
  remove,
);

export { attachmentRouter };
