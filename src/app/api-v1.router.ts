import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";

/**
 * Aggregates all v1 module routers.
 * New modules (organization, project, etc.) register their router
 * here as they're introduced — this file should stay a thin
 * aggregator, not contain business logic.
 */
const apiV1Router: Router = Router();

apiV1Router.use(healthRouter);
apiV1Router.use("/auth", authRouter);

export { apiV1Router };
