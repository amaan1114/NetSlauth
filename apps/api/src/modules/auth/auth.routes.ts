import { Router } from "express";
import rateLimit from "express-rate-limit";
import { csrfProtection } from "../../middleware/csrfProtection.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";
import { HttpError } from "../../utils/HttpError.js";
import {
  signUpController, signInController, getMeController,
  refreshSessionController, logoutController, csrfController,
} from "./auth.controller.js";

const router = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, "Too many authentication attempts; try again later")),
});

router.get("/csrf", csrfController);
router.post("/register", authLimit, csrfProtection, signUpController);
router.post("/login", authLimit, csrfProtection, signInController);
router.post("/refresh", csrfProtection, refreshSessionController);
router.post("/logout", csrfProtection, logoutController);
router.get("/me", authMiddleware, getMeController);

export default router;
