import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { projectParamsSchema } from "../projects/project.validation.js";
import { agentParamsSchema, registerAgentSchema } from "./agent.validation.js";
import { registerAgentService, getAgentsService, getAgentService, revokeAgentService } from "./agent.service.js";

export const registerAgentController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const { name } = registerAgentSchema.parse(req.body);
    const data = await registerAgentService(req.userId!, projectId, name);
    res.set("Cache-Control", "no-store");
    return res.status(201).json(new HttpResponse(201, "Agent registered successfully", data));
  } catch (error) {
    next(error);
  }
};

export const getAgentsController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const agents = await getAgentsService(req.userId!, projectId);
    return res.json(new HttpResponse(200, "Agents retrieved successfully", { agents }));
  } catch (error) {
    next(error);
  }
};

export const getAgentController: RequestHandler = async (req, res, next) => {
  try {
    const { agentId } = agentParamsSchema.parse(req.params);
    const agent = await getAgentService(req.userId!, agentId);
    return res.json(new HttpResponse(200, "Agent retrieved successfully", { agent }));
  } catch (error) {
    next(error);
  }
};

export const revokeAgentController: RequestHandler = async (req, res, next) => {
  try {
    const { agentId } = agentParamsSchema.parse(req.params);
    const agent = await revokeAgentService(req.userId!, agentId);
    return res.json(new HttpResponse(200, "Agent revoked successfully", { agent }));
  } catch (error) {
    next(error);
  }
};
