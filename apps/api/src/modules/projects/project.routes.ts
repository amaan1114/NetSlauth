import { Router } from "express";
import { createProjectController, getProjectsController, getProjectController } from "./project.controller.js";

export const workspaceProjectRoutes = Router({ mergeParams: true });
workspaceProjectRoutes.post("/", createProjectController);
workspaceProjectRoutes.get("/", getProjectsController);

const router = Router();
router.get("/:projectId", getProjectController);

export default router;
