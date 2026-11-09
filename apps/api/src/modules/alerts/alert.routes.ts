import { Router } from "express";
import { getAlertsController } from "./alert.controller.js";

const router = Router({ mergeParams: true });
router.get("/", getAlertsController);

export default router;
