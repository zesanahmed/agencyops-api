/**
 * Base class for predictable, "operational" application errors
 * (bad input, not found, unauthorized, etc.) as opposed to
 * unexpected programming errors/bugs.
 *
 * Future modules should throw AppError (or a subclass of it)
 * instead of plain Error when the failure is an expected
 * business/request condition. The centralized error handler
 * uses `isOperational` to decide how much detail is safe to
 * expose to the client.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors: unknown[];

  constructor(
    message: string,
    statusCode = 500,
    errors: unknown[] = [],
    isOperational = true,
  ) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}
