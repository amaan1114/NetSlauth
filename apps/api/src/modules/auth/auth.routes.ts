import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Database } from "@workspace/netsleuth-database";
import { csrfProtection } from "../../middleware/csrfProtection.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";
import { HttpError } from "../../utils/HttpError.js";
import { createAuthService } from "./auth.service.js";
import { createAuthController } from "./auth.controller.js";

export function createAuthRoutes(database: Database) {
  const router = Router();
  const service = createAuthService(database);
  const controller = createAuthController(service);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30,
    standardHeaders: "draft-7", legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, "Too many authentication attempts; try again later")),
  });
  router.get("/csrf", controller.csrf);
  router.post("/register", limit, csrfProtection, controller.register);
  router.post("/login", limit, csrfProtection, controller.login);
  router.post("/refresh", csrfProtection, controller.refresh);
  router.post("/logout", csrfProtection, controller.logout);
  router.get("/me", authMiddleware(service), controller.me);
  return router;
}
