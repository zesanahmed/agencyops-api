import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { verifyAccessToken } from "./token.service.js";

const BEARER_PREFIX = "Bearer ";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError("Authentication required", 401);
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    throw new AppError("Authentication required", 401);
  }

  const payload = await verifyAccessToken(token);

  req.auth = { userId: payload.sub, sessionId: payload.sid };
  next();
}
