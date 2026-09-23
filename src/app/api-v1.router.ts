import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";
import { organizationRouter } from "../modules/organization/organization.routes.js";

const apiV1Router: Router = Router();

apiV1Router.use(healthRouter);
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/organizations", organizationRouter);

export { apiV1Router };
