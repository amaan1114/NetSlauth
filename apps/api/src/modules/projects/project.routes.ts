import { Router } from "express";
import { createProjectController, getProjectsController, getProjectController, getDatabasePolicyController, updateDatabasePolicyController } from "./project.controller.js";
import { projectAgentRoutes } from "../agents/agent.routes.js";
import alertRoutes from "../alerts/alert.routes.js";
import dashboardRoutes from "../dashboard/dashboard.routes.js";
import eventExplorerRoutes from "../events/event-explorer.routes.js";

export const workspaceProjectRoutes = Router({ mergeParams: true });
workspaceProjectRoutes.post("/", createProjectController);
workspaceProjectRoutes.get("/", getProjectsController);

const router = Router();
router.use("/:projectId/dashboard", dashboardRoutes);
router.use("/:projectId/agents", projectAgentRoutes);
router.use("/:projectId/alerts", alertRoutes);
router.use("/:projectId/events", eventExplorerRoutes);
router.get("/:projectId/database-policy", getDatabasePolicyController);
router.put("/:projectId/database-policy", updateDatabasePolicyController);
router.get("/:projectId", getProjectController);

export default router;
