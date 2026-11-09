import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { workspaceParamsSchema } from "../workspaces/workspace.validation.js";
import { createProjectSchema, projectParamsSchema } from "./project.validation.js";
import { createProjectService, getProjectsService, getProjectService } from "./project.service.js";

export const createProjectController: RequestHandler = async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const { name, description } = createProjectSchema.parse(req.body);
    const project = await createProjectService(req.userId!, workspaceId, name, description);
    return res.status(201).json(new HttpResponse(201, "Project created successfully", { project }));
  } catch (error) {
    next(error);
  }
};

export const getProjectsController: RequestHandler = async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const projects = await getProjectsService(req.userId!, workspaceId);
    return res.json(new HttpResponse(200, "Projects retrieved successfully", { projects }));
  } catch (error) {
    next(error);
  }
};

export const getProjectController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const project = await getProjectService(req.userId!, projectId);
    return res.json(new HttpResponse(200, "Project retrieved successfully", { project }));
  } catch (error) {
    next(error);
  }
};
