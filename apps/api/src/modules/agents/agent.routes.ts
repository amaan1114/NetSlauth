import { Router } from "express";
import { registerAgentController, getAgentsController, getAgentController, revokeAgentController } from "./agent.controller.js";

export const projectAgentRoutes = Router({ mergeParams: true });
projectAgentRoutes.post("/", registerAgentController);
projectAgentRoutes.get("/", getAgentsController);

const router = Router();
router.get("/:agentId", getAgentController);
router.post("/:agentId/revoke", revokeAgentController);

export default router;
