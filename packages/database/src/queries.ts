import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client.js";
import { agents, networkEvents, projects, securityAlerts } from "./schema/index.js";

export const projectScopeSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
}).strict();

export type ProjectScope = z.infer<typeof projectScopeSchema>;

// Callers must first authorize the user's membership in the supplied workspace.
// Every monitoring read joins back to projects and checks BOTH scope identifiers.
export function listAgentsInProject(db: Database, scope: ProjectScope) {
  const { workspaceId, projectId } = projectScopeSchema.parse(scope);
  return db.select(getTableColumns(agents))
    .from(agents)
    .innerJoin(projects, eq(agents.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .orderBy(desc(agents.createdAt))
    .limit(100);
}

export function listNetworkEventsInProject(db: Database, scope: ProjectScope) {
  const { workspaceId, projectId } = projectScopeSchema.parse(scope);
  return db.select(getTableColumns(networkEvents))
    .from(networkEvents)
    .innerJoin(agents, eq(networkEvents.agentId, agents.id))
    .innerJoin(projects, eq(agents.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .orderBy(desc(networkEvents.occurredAt))
    .limit(100);
}

export function listSecurityAlertsInProject(db: Database, scope: ProjectScope) {
  const { workspaceId, projectId } = projectScopeSchema.parse(scope);
  return db.select(getTableColumns(securityAlerts))
    .from(securityAlerts)
    .innerJoin(projects, eq(securityAlerts.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .orderBy(desc(securityAlerts.lastSeenAt))
    .limit(100);
}
