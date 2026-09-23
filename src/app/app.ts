import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { apiV1Router } from "./api-v1.router.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { notFoundHandler } from "../middlewares/notFoundHandler.js";

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(cookieParser());

  app.use("/api/v1", apiV1Router);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  // Error handler must be registered last, after everything else.
  app.use(errorHandler);

  return app;
}
