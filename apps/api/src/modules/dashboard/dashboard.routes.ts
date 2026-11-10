import { Router } from "express";
import { getDashboardActivityController, getDashboardSummaryController } from "./dashboard.controller.js";

const router = Router({ mergeParams: true });
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/summary", getDashboardSummaryController);
router.get("/activity", getDashboardActivityController);
export default router;
