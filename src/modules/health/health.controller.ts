import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";

/**
 * GET /api/v1/health
 * Basic liveness check — no dependencies (DB, Redis, etc.) yet,
 * since none exist in this stage of the project.
 */
export function getHealth(_req: Request, res: Response): void {
  sendSuccess(res, {}, "API is healthy");
}
