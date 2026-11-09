import { Router } from "express";
import { workspaceProjectRoutes } from "../projects/project.routes.js";
import {
  createWorkspaceController, getWorkspacesController, getWorkspaceController,
} from "./workspace.controller.js";

const router = Router();

router.post("/", createWorkspaceController);
router.get("/", getWorkspacesController);
router.get("/:workspaceId", getWorkspaceController);
router.use("/:workspaceId/projects", workspaceProjectRoutes);

export default router;
