import { and, eq, isNull } from "drizzle-orm";
import { agents, projects, workspaceMembers, publicAgentColumns } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

export const createAgent = async (projectId: string, name: string, apiKeyHash: string) => {
  const [agent] = await db.insert(agents).values({ projectId, name, apiKeyHash }).returning(publicAgentColumns);
  if (!agent) throw new Error("Agent registration failed");
  return agent;
};

export const getUserAgent = async (userId: string, agentId: string) => {
  const [agent] = await db.select(publicAgentColumns).from(agents)
    .innerJoin(projects, eq(projects.id, agents.projectId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
    .where(and(eq(agents.id, agentId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return agent;
};

export const revokeAgent = async (agentId: string, projectId: string) => {
  const [agent] = await db.update(agents).set({ revokedAt: new Date(), status: "INACTIVE" })
    .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    .returning(publicAgentColumns);
  return agent;
};

export const getAgentByKeyHash = async (apiKeyHash: string) => {
  const [agent] = await db.select({ id: agents.id, projectId: agents.projectId }).from(agents)
    .where(and(eq(agents.apiKeyHash, apiKeyHash), isNull(agents.revokedAt)))
    .limit(1);
  return agent;
};
