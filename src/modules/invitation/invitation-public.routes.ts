import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authenticate } from "../auth/auth.middleware.js";
import { accept, preview } from "./invitation.controller.js";
import { invitationTokenParamSchema } from "./invitation.validation.js";

const invitationPublicRouter: Router = Router();

invitationPublicRouter.get(
  "/:token",
  validate({ params: invitationTokenParamSchema }),
  preview,
);

invitationPublicRouter.post(
  "/:token/accept",
  validate({ params: invitationTokenParamSchema }),
  authenticate,
  accept,
);

export { invitationPublicRouter };
