import { Router } from "express";
import { agentAuthMiddleware } from "../agents/agent.middleware.js";
import { ingestEventsController } from "./event.controller.js";

const router = Router();
router.post("/events", agentAuthMiddleware, ingestEventsController);

export default router;
