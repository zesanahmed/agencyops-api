import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authRateLimiter } from "../../middlewares/rateLimit.js";
import { authenticate } from "../auth/auth.middleware.js";
import { accept, preview } from "./invitation.controller.js";
import { invitationTokenParamSchema } from "./invitation.validation.js";

const invitationPublicRouter: Router = Router();

// Rate limited — the token is a bearer secret; without a limit here,
// someone could brute-force-guess valid invitation tokens.
invitationPublicRouter.get(
  "/:token",
  authRateLimiter,
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
