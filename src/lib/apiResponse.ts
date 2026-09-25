import type { Response } from "express";
import type {
  ErrorResponse,
  JsonValue,
  SuccessResponse,
} from "../types/api-response.js";

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
