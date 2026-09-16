import { Router } from "express";
import { getHealth } from "./health.controller.js";

const healthRouter: Router = Router();

healthRouter.get("/health", getHealth);

export { healthRouter };
