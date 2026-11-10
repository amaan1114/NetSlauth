import { and, desc, eq, gte, lt } from "drizzle-orm";
import { agents, networkEvents } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";
import type { EventQuery } from "./event-explorer.validation.js";

// Select only public fields; metadata is fetched on demand for one scoped record.
const eventColumns = {
  id: networkEvents.id,
  projectId: agents.projectId,
  agentId: networkEvents.agentId,
  agentName: agents.name,
  eventType: networkEvents.eventType,
  sourceIp: networkEvents.sourceIp,
  sourcePort: networkEvents.sourcePort,
  destinationIp: networkEvents.destinationIp,
  destinationPort: networkEvents.destinationPort,
  protocol: networkEvents.protocol,
  occurredAt: networkEvents.occurredAt,
};

export const listProjectEvents = (projectId: string, query: EventQuery) => db
  .select(eventColumns).from(networkEvents)
  .innerJoin(agents, eq(agents.id, networkEvents.agentId))
  .where(and(
    eq(agents.projectId, projectId),
    query.eventType ? eq(networkEvents.eventType, query.eventType) : undefined,
    query.protocol ? eq(networkEvents.protocol, query.protocol) : undefined,
    query.sourceIp ? eq(networkEvents.sourceIp, query.sourceIp) : undefined,
    query.destinationIp ? eq(networkEvents.destinationIp, query.destinationIp) : undefined,
    query.agentId ? eq(networkEvents.agentId, query.agentId) : undefined,
    query.start ? gte(networkEvents.occurredAt, new Date(query.start)) : undefined,
    query.end ? lt(networkEvents.occurredAt, new Date(query.end)) : undefined,
  ))
  .orderBy(desc(networkEvents.occurredAt), desc(networkEvents.id))
  .limit(query.limit + 1).offset(query.offset);

export const findProjectEvent = async (projectId: string, eventRecordId: string) => {
  const [event] = await db.select({
    ...eventColumns,
    eventId: networkEvents.eventId,
    receivedAt: networkEvents.receivedAt,
    metadata: networkEvents.metadata,
  }).from(networkEvents)
    .innerJoin(agents, eq(agents.id, networkEvents.agentId))
    .where(and(eq(agents.projectId, projectId), eq(networkEvents.id, eventRecordId)))
    .limit(1);
  return event;
};
