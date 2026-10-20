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
  const clientError = isAppError ? undefined : toClientError(err);

  const statusCode = isAppError ? err.statusCode : (clientError?.statusCode ?? 500);
  const message = isAppError ? err.message : (clientError?.message ?? "Something went wrong");
  const errors = isAppError ? err.errors : [];

  // Unexpected failures must be visible in production logs too, otherwise a 500 leaves no trace.
  // Prisma error messages can embed the query arguments (emails, hashes), so those are logged by
  // name/code only; nothing from the request (body, headers, cookies) is ever logged.
  if (!isAppError && !clientError) {
    // eslint-disable-next-line no-console
    console.error("[agencyops-api] unhandled error:", describeError(err));
  }

  const body: ErrorResponse = {
    success: false,
    message,
    errors,
  };

  res.status(statusCode).json(body);
}

/** Malformed JSON / oversized bodies are the caller's fault (4xx), not a server error. */
function toClientError(err: unknown): { statusCode: number; message: string } | undefined {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return { statusCode: 400, message: "Request body is not valid JSON" };
  if (type === "entity.too.large") return { statusCode: 413, message: "Request body is too large" };
  return undefined;
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "non-Error value thrown";
  const code = (err as { code?: unknown }).code;
  const codePart = typeof code === "string" ? ` (${code})` : "";
  if (!env.isProduction) return err.stack ?? err.message; // full detail while developing
  if (err.name.startsWith("PrismaClient")) return `${err.name}${codePart}`;
  return `${err.name}${codePart}: ${err.message}`;
}
