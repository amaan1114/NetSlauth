import { Router } from "express";
import { getAlertController, getAlertsController, getRelatedEventsController, setAlertStatusController } from "./alert.controller.js";

const router = Router({ mergeParams: true });
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/", getAlertsController);
router.get("/:alertId", getAlertController);
router.patch("/:alertId/status", setAlertStatusController);
router.get("/:alertId/events", getRelatedEventsController);

export default router;
