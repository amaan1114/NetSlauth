import { and, desc, eq, getTableColumns, gte, lt, sql } from "drizzle-orm";
import { agents, networkEvents, securityAlerts } from "@workspace/netsleuth-database";
import type { AlertStatus } from "@workspace/netsleuth-shared";
import type { z } from "zod";
import { db } from "../../services/database.js";
import type { alertQuerySchema } from "./alert.validation.js";

export const listProjectAlerts = (projectId: string, query: z.infer<typeof alertQuerySchema>) => db
  .select(getTableColumns(securityAlerts)).from(securityAlerts)
  .where(and(
    eq(securityAlerts.projectId, projectId),
    query.severity ? eq(securityAlerts.severity, query.severity) : undefined,
    query.status ? eq(securityAlerts.status, query.status) : undefined,
    query.ruleId ? eq(securityAlerts.ruleId, query.ruleId) : undefined,
    // Compare canonical address strings without casting untrusted stored JSON to inet.
    query.sourceIp ? sql`CASE WHEN jsonb_typeof(${securityAlerts.evidence}->'sourceIp') = 'string'
      THEN ${securityAlerts.evidence}->>'sourceIp' END = host(${query.sourceIp}::inet)` : undefined,
    query.start ? gte(securityAlerts.lastSeenAt, new Date(query.start)) : undefined,
    query.end ? lt(securityAlerts.lastSeenAt, new Date(query.end)) : undefined,
  ))
  .orderBy(desc(securityAlerts.lastSeenAt), securityAlerts.id)
  .limit(query.limit + 1).offset((query.page - 1) * query.limit);

export const findProjectAlert = async (projectId: string, alertId: string) => {
  const [alert] = await db.select().from(securityAlerts)
    .where(and(eq(securityAlerts.projectId, projectId), eq(securityAlerts.id, alertId))).limit(1);
  return alert;
};

export const updateProjectAlertStatus = async (projectId: string, alertId: string, status: AlertStatus) => {
  const [alert] = await db.update(securityAlerts).set({ status, updatedAt: new Date() })
    .where(and(eq(securityAlerts.projectId, projectId), eq(securityAlerts.id, alertId))).returning();
  return alert;
};

export const findAlertAgent = async (projectId: string, agentId: string) => {
  const [agent] = await db.select({ id: agents.id, name: agents.name }).from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.id, agentId))).limit(1);
  return agent ?? null;
};

export const listAlertRelatedEvents = (projectId: string, alertId: string, page: number, limit: number) => db.select({
  id: networkEvents.id,
  projectId: agents.projectId,
  agentId: agents.id,
  agentName: agents.name,
  eventType: networkEvents.eventType,
  sourceIp: networkEvents.sourceIp,
  sourcePort: networkEvents.sourcePort,
  destinationIp: networkEvents.destinationIp,
  destinationPort: networkEvents.destinationPort,
  protocol: networkEvents.protocol,
  occurredAt: networkEvents.occurredAt,
}).from(networkEvents)
  .innerJoin(agents, eq(agents.id, networkEvents.agentId))
  .innerJoin(securityAlerts, and(eq(securityAlerts.id, alertId), eq(securityAlerts.projectId, projectId)))
  .where(and(
    eq(agents.projectId, projectId),
    sql`(
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(${securityAlerts.evidence}->'events') = 'array'
          THEN ${securityAlerts.evidence}->'events' ELSE '[]'::jsonb END
        ) AS reference
        WHERE reference->>'id' = ${networkEvents.id}::text
          AND reference->>'agentId' = ${networkEvents.agentId}::text
      )
      OR (${securityAlerts.agentId} = ${networkEvents.agentId}
          AND ${securityAlerts.evidence}->>'eventId' = ${networkEvents.eventId})
    )`,
  ))
  .orderBy(desc(networkEvents.occurredAt), networkEvents.id)
  .limit(limit + 1).offset((page - 1) * limit);
