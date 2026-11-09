import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client.js";
import { agents, networkEvents, projects, securityAlerts, alertSeverity, alertStatus } from "./schema/index.js";

export const projectScopeSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
}).strict();

export type ProjectScope = z.infer<typeof projectScopeSchema>;

// Explicit projection shared by agent reads and writes: credentials never leave the repository.
export const publicAgentColumns = {
  id: agents.id,
  projectId: agents.projectId,
  name: agents.name,
  status: agents.status,
  lastHeartbeatAt: agents.lastHeartbeatAt,
  revokedAt: agents.revokedAt,
  createdAt: agents.createdAt,
  updatedAt: agents.updatedAt,
};

// Callers must first authorize the user's membership in the supplied workspace.
// Every monitoring read joins back to projects and checks BOTH scope identifiers.
export function listAgentsInProject(db: Database, scope: ProjectScope) {
  const { workspaceId, projectId } = projectScopeSchema.parse(scope);
  return db.select(publicAgentColumns)
    .from(agents)
    .innerJoin(projects, eq(agents.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .orderBy(desc(agents.createdAt), agents.id)
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

export const alertListOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(100),
  offset: z.number().int().min(0).default(0),
  severity: z.enum(alertSeverity.enumValues).optional(),
  status: z.enum(alertStatus.enumValues).optional(),
}).strict();

export function listSecurityAlertsInProject(
  db: Database, scope: ProjectScope, options: z.input<typeof alertListOptionsSchema> = {},
) {
  const { workspaceId, projectId } = projectScopeSchema.parse(scope);
  const { limit, offset, severity, status } = alertListOptionsSchema.parse(options);
  return db.select(getTableColumns(securityAlerts))
    .from(securityAlerts)
    .innerJoin(projects, eq(securityAlerts.projectId, projects.id))
    .where(and(
      eq(projects.workspaceId, workspaceId), eq(projects.id, projectId),
      severity ? eq(securityAlerts.severity, severity) : undefined,
      status ? eq(securityAlerts.status, status) : undefined,
    ))
    .orderBy(desc(securityAlerts.lastSeenAt), securityAlerts.id)
    .limit(limit).offset(offset);
}
