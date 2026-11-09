import { createHash, randomBytes } from "node:crypto";
import { listAgentsInProject } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";
import { HttpError } from "../../utils/HttpError.js";
import { getProjectService } from "../projects/project.service.js";
import { createAgent, getUserAgent, revokeAgent, getAgentByKeyHash } from "./agent.repo.js";

export const hashAgentKey = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex");

export const registerAgentService = async (userId: string, projectId: string, name: string) => {
  await getProjectService(userId, projectId);
  // 256 bits of randomness; fast SHA-256 is safe for high-entropy keys, unlike passwords.
  const apiKey = `ns_agent_${randomBytes(32).toString("hex")}`;
  const agent = await createAgent(projectId, name, hashAgentKey(apiKey));
  return { agent, apiKey };
};

export const getAgentsService = async (userId: string, projectId: string) => {
  const project = await getProjectService(userId, projectId);
  return listAgentsInProject(db, { workspaceId: project.workspaceId, projectId: project.id });
};

export const getAgentService = async (userId: string, agentId: string) => {
  const agent = await getUserAgent(userId, agentId);
  if (!agent) throw new HttpError(404, "Agent not found");
  return agent;
};

export const revokeAgentService = async (userId: string, agentId: string) => {
  const agent = await getAgentService(userId, agentId);
  if (agent.revokedAt) return agent;
  const revoked = await revokeAgent(agent.id, agent.projectId);
  if (!revoked) throw new HttpError(404, "Agent not found");
  return revoked;
};

export const authenticateAgentService = async (apiKey: string) => {
  const agent = await getAgentByKeyHash(hashAgentKey(apiKey));
  if (!agent) throw new HttpError(401, "Invalid agent credential");
  return agent;
};
