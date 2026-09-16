import { Router } from "express";
import { healthRouter } from "../modules/health/health.routes.js";

/**
 * Aggregates all v1 module routers.
 * New modules (auth, organization, etc.) register their router
 * here as they're introduced — this file should stay a thin
 * aggregator, not contain business logic.
 */
const apiV1Router: Router = Router();

apiV1Router.use(healthRouter);

export { apiV1Router };
