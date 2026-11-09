import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import type { Database } from "@workspace/netsleuth-database";
import { env } from "./config/env.js";
import { globalErrorHandler } from "./middleware/globalErrorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { checkDatabase, db } from "./services/database.js";
import { createAuthRoutes } from "./modules/auth/auth.routes.js";
import { HttpError } from "./utils/HttpError.js";
import { HttpResponse } from "./utils/HttpResponse.js";

export function createApp(checkReady: () => Promise<void> = checkDatabase, database: Database = db) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use("/api/v1/auth", createAuthRoutes(database));

  const health = express.Router();
  health.get("/health", (_req, res) => {
    res.status(200).json(new HttpResponse(200, "API is running", { status: "ok" }));
  });
  health.get("/health/ready", async (_req, res) => {
    try {
      await checkReady();
    } catch {
      throw new HttpError(503, "Database is unavailable");
    }
    res.status(200).json(new HttpResponse(200, "API is ready", { database: "connected" }));
  });

  app.use(health);
  app.use("/api", health);
  // Keep the original starter probe compatible; new endpoints use HttpResponse.
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

  app.use((_req, _res, next) => next(new HttpError(404, "Route not found")));
  app.use(globalErrorHandler);
  return app;
}
