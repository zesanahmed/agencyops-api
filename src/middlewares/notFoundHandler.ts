import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Catches any request that didn't match a route and forwards
 * a standard 404 AppError to the centralized error handler,
 * so unmatched routes still return the standard error envelope.
 */
export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}
