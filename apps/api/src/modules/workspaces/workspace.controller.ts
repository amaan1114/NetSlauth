import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { createWorkspaceSchema, workspaceParamsSchema } from "./workspace.validation.js";
import { createWorkspaceService, getWorkspacesService, requireWorkspaceMember } from "./workspace.service.js";

export const createWorkspaceController: RequestHandler = async (req, res, next) => {
  try {
    const { name } = createWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspaceService(req.userId!, name);
    return res.status(201).json(new HttpResponse(201, "Workspace created successfully", { workspace }));
  } catch (error) {
    next(error);
  }
};

export const getWorkspacesController: RequestHandler = async (req, res, next) => {
  try {
    const workspaces = await getWorkspacesService(req.userId!);
    return res.json(new HttpResponse(200, "Workspaces retrieved successfully", { workspaces }));
  } catch (error) {
    next(error);
  }
};

export const getWorkspaceController: RequestHandler = async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const workspace = await requireWorkspaceMember(req.userId!, workspaceId);
    return res.json(new HttpResponse(200, "Workspace retrieved successfully", { workspace }));
  } catch (error) {
    next(error);
  }
};
