import { Router } from "express";
import { createProjectController, getProjectsController, getProjectController } from "./project.controller.js";
import { projectAgentRoutes } from "../agents/agent.routes.js";

export const workspaceProjectRoutes = Router({ mergeParams: true });
workspaceProjectRoutes.post("/", createProjectController);
workspaceProjectRoutes.get("/", getProjectsController);

const router = Router();
router.use("/:projectId/agents", projectAgentRoutes);
router.get("/:projectId", getProjectController);

export default router;
