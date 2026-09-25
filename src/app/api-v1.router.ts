import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";
import { invitationPublicRouter } from "../modules/invitation/invitation-public.routes.js";
import { organizationRouter } from "../modules/organization/organization.routes.js";

const apiV1Router: Router = Router();

apiV1Router.use(healthRouter);
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/organizations", organizationRouter);
apiV1Router.use("/invitations", invitationPublicRouter);

export { apiV1Router };
