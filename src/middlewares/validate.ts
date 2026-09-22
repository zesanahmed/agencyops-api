import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../errors/AppError.js";

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Reusable Zod validation middleware factory — the project's
 * general-purpose `validate(schema)` concept. Validates whichever
 * of body/params/query a schema is given for, and replaces
 * req.<part> with the parsed result so downstream handlers work
 * with validated, typed data rather than raw unknown input.
 *
 * Validation only — no authorization or business-rule checks here
 * (those are separate concerns, handled elsewhere: authentication
 * in auth.middleware.ts, business logic in each module's service).
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      req.body = parseOrThrow(schemas.body, req.body);
    }
    if (schemas.params) {
      req.params = parseOrThrow(
        schemas.params,
        req.params,
      ) as typeof req.params;
    }
    if (schemas.query) {
      req.query = parseOrThrow(schemas.query, req.query) as typeof req.query;
    }
    next();
  };
}

function parseOrThrow(schema: ZodType, input: unknown): unknown {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      "Validation failed",
      400,
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
