import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { workspaceParamsSchema } from "../workspaces/workspace.validation.js";
import { createProjectSchema, projectParamsSchema, updateDatabasePolicySchema } from "./project.validation.js";
import { createProjectService, getProjectsService, getProjectService, updateDatabasePolicyService } from "./project.service.js";

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

export const getDatabasePolicyController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const project = await getProjectService(req.userId!, projectId);
    return res.json(new HttpResponse(200, "Database policy retrieved successfully", { databasePolicy: project.databasePolicy }));
  } catch (error) {
    next(error);
  }
};

export const updateDatabasePolicyController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const { databasePolicy } = updateDatabasePolicySchema.parse(req.body);
    const policy = await updateDatabasePolicyService(req.userId!, projectId, databasePolicy);
    return res.json(new HttpResponse(200, "Database policy updated successfully", { databasePolicy: policy }));
  } catch (error) {
    next(error);
  }
};
