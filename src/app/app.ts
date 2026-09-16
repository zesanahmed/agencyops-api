import express, { type Express } from "express";
import { apiV1Router } from "./api-v1.router.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { notFoundHandler } from "../middlewares/notFoundHandler.js";

/**
 * Builds and configures the Express application.
 *
 * Deliberately does NOT call `.listen()` — application setup is
 * kept separate from server startup (see src/server.ts) so the
 * app instance can be imported directly in tests without
 * binding a real port.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api/v1", apiV1Router);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  // Error handler must be registered last, after everything else.
  app.use(errorHandler);

  return app;
}
