import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import type { ErrorResponse } from "../types/api-response.js";

/**
 * Single centralized error handler. Every error in the app
 * (thrown in a route/middleware, or passed to next(err)) ends
 * up here, so response shape and logging stay consistent as
 * more modules are added.
 *
 * Must be registered LAST, after all routes and other
 * middlewares, and must keep all four parameters for Express
 * to recognize it as an error-handling middleware.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;

  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : "Something went wrong";
  const errors = isAppError ? err.errors : [];

  // Never leak stack traces or internal error details in production.
  if (!env.isProduction) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  const body: ErrorResponse = {
    success: false,
    message,
    errors,
  };

  res.status(statusCode).json(body);
}
