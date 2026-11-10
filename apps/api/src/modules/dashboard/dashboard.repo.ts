import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { agents, networkEvents, securityAlerts } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

export const getDashboardRecords = async (projectId: string) => {
  const [agentCounts, eventCounts, alertCounts, recentAlerts, agentHealth] = await Promise.all([
    db.select({
      total: count(),
      online: sql<number>`count(*) filter (where ${agents.status} = 'ONLINE')`.mapWith(Number),
      offline: sql<number>`count(*) filter (where ${agents.status} = 'OFFLINE')`.mapWith(Number),
      inactive: sql<number>`count(*) filter (where ${agents.status} = 'INACTIVE')`.mapWith(Number),
    }).from(agents).where(eq(agents.projectId, projectId)),
    db.select({ total: count() }).from(networkEvents)
      .innerJoin(agents, eq(networkEvents.agentId, agents.id))
      .where(eq(agents.projectId, projectId)),
    db.select({ severity: securityAlerts.severity, status: securityAlerts.status, total: count() })
      .from(securityAlerts).where(eq(securityAlerts.projectId, projectId))
      .groupBy(securityAlerts.severity, securityAlerts.status),
    db.select({
      id: securityAlerts.id, projectId: securityAlerts.projectId, title: securityAlerts.title,
      severity: securityAlerts.severity, status: securityAlerts.status, ruleId: securityAlerts.ruleId,
      sourceIp: sql<string | null>`case
        when jsonb_typeof(${securityAlerts.evidence}->'sourceIp') = 'string'
        then ${securityAlerts.evidence}->>'sourceIp' else null end`,
      firstSeenAt: securityAlerts.firstSeenAt,
    }).from(securityAlerts).where(eq(securityAlerts.projectId, projectId))
      .orderBy(desc(securityAlerts.firstSeenAt), desc(securityAlerts.id)).limit(8),
    db.select({
      id: agents.id, projectId: agents.projectId, name: agents.name, status: agents.status,
      lastHeartbeatAt: agents.lastHeartbeatAt, revokedAt: agents.revokedAt,
    }).from(agents).where(eq(agents.projectId, projectId)).orderBy(agents.id).limit(11),
  ]);
  return { agentCounts: agentCounts[0]!, eventCounts: eventCounts[0]!, alertCounts, recentAlerts, agentHealth };
};

export const getActivityCounts = async (projectId: string, from: Date, to: Date, intervalMinutes: number) => {
  const bucket = sql<number>`floor(extract(epoch from
    (${networkEvents.occurredAt} - ${from.toISOString()}::timestamptz)) / ${intervalMinutes * 60})::integer`.mapWith(Number);
  return db.select({
    bucket,
    network: sql<number>`count(*) filter (where ${networkEvents.eventType} in
      ('NETWORK_CONNECTION_ATTEMPT', 'NETWORK_CONNECTION_ESTABLISHED'))`.mapWith(Number),
    authentication: sql<number>`count(*) filter (where ${networkEvents.eventType} in
      ('AUTHENTICATION_FAILURE', 'AUTHENTICATION_SUCCESS'))`.mapWith(Number),
    heartbeat: sql<number>`count(*) filter (where ${networkEvents.eventType} = 'AGENT_HEARTBEAT')`.mapWith(Number),
    service: sql<number>`count(*) filter (where ${networkEvents.eventType} = 'SERVICE_DISCOVERED')`.mapWith(Number),
  }).from(networkEvents).innerJoin(agents, eq(networkEvents.agentId, agents.id))
    .where(and(eq(agents.projectId, projectId), gte(networkEvents.occurredAt, from), lt(networkEvents.occurredAt, to)))
    .groupBy(sql`1`).orderBy(sql`1`);
};
