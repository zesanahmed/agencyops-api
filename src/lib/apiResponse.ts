import type { Response } from "express";
import type {
  ErrorResponse,
  JsonValue,
  SuccessResponse,
} from "../types/api-response.js";

/**
 * Sends a standardized success response.
 * Keeps the { success, message, data } envelope consistent
 * across every route/module. `data` accepts any JSON-safe
 * value (object, array, primitive, or null) — not just
 * plain objects — so endpoints returning a list, a count,
 * or nothing aren't forced to wrap it artificially.
 */
export function sendSuccess<T extends JsonValue = JsonValue>(
  res: Response,
  data: T,
  message = "Operation successful",
  statusCode = 200,
): void {
  const body: SuccessResponse<T> = {
    success: true,
    message,
    data,
  };

  res.status(statusCode).json(body);
}

/**
 * Sends a standardized error response.
 * Used directly for simple cases; the centralized error handler
 * uses the same envelope for errors thrown/forwarded via next().
 */
export function sendError(
  res: Response,
  message = "Something went wrong",
  statusCode = 500,
  errors: unknown[] = [],
): void {
  const body: ErrorResponse = {
    success: false,
    message,
    errors,
  };

  res.status(statusCode).json(body);
}
