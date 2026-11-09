import type { RequestHandler } from "express";
import { HttpError } from "../../utils/HttpError.js";
import { authenticateAgentService } from "./agent.service.js";

export const agentAuthMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const apiKey = req.get("X-Agent-Key");
    if (!apiKey || !/^ns_agent_[a-f0-9]{64}$/.test(apiKey)) {
      throw new HttpError(401, "Invalid agent credential");
    }
    const agent = await authenticateAgentService(apiKey);
    // Identity and scope always come from the credential's database row, never the request body.
    req.agentId = agent.id;
    req.projectId = agent.projectId;
    next();
  } catch (error) {
    next(error);
  }
};
