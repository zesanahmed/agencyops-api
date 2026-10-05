import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../errors/AppError.js";

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      req.body = parseOrThrow(schemas.body, req.body);
    }
    if (schemas.params) {
      // MERGE the parsed params into req.params instead of replacing them. Replacing drops every
      // param the schema doesn't declare (e.g. projectId on routes validated with taskIdParamSchema),
      // which leaves handlers reading `undefined` and makes Prisma ignore that filter entirely.
      req.params = {
        ...req.params,
        ...(parseOrThrow(schemas.params, req.params) as Record<string, string>),
      } as typeof req.params;
    }
    if (schemas.query) {
      const parsedQuery = parseOrThrow(schemas.query, req.query);

      Object.defineProperty(req, "query", {
        value: parsedQuery,
        writable: true,
        configurable: true,
        enumerable: true,
      });
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
