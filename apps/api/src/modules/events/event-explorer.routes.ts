import { Router } from "express";
import { getProjectEventController, getProjectEventsController } from "./event-explorer.controller.js";

const router = Router({ mergeParams: true });
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/", getProjectEventsController);
router.get("/:eventRecordId", getProjectEventController);
export default router;
