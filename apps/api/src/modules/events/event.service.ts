import { and, eq, isNull } from "drizzle-orm";
import { agents, networkEvents } from "@workspace/netsleuth-database";
import type { NetworkEventInput } from "@workspace/netsleuth-shared";
import { db } from "../../services/database.js";
import { HttpError } from "../../utils/HttpError.js";
import { detectEventsService } from "../detections/detection.service.js";
import { emitProjectRealtime } from "../../realtime.js";

export const ingestEventsService = async (agentId: string, projectId: string, events: NetworkEventInput[]) => {
  const inserted = await db.transaction(async (transaction) => {
    // Recheck and lock the authenticated row so revocation cannot race the write.
    const [agent] = await transaction.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId), isNull(agents.revokedAt)))
      .for("update");
    if (!agent) throw new HttpError(401, "Invalid agent credential");

    const inserted = await transaction.insert(networkEvents).values(events.map((event) => ({
      ...event,
      agentId: agent.id,
      occurredAt: new Date(event.occurredAt),
    })))
      .onConflictDoNothing({ target: [networkEvents.agentId, networkEvents.eventId] })
      .returning({
        id: networkEvents.id,
        agentId: networkEvents.agentId,
        eventId: networkEvents.eventId,
        eventType: networkEvents.eventType,
        sourceIp: networkEvents.sourceIp,
        sourcePort: networkEvents.sourcePort,
        destinationIp: networkEvents.destinationIp,
        destinationPort: networkEvents.destinationPort,
        protocol: networkEvents.protocol,
        occurredAt: networkEvents.occurredAt,
      });

    if (inserted.some((event) => event.eventType === "AGENT_HEARTBEAT")) {
      await transaction.update(agents).set({ status: "ONLINE", lastHeartbeatAt: new Date() })
        .where(eq(agents.id, agent.id));
    }
    return inserted;
  });
  for (const event of inserted) {
    emitProjectRealtime(projectId, {
      name: "network_event:new",
      payload: {
        ...event,
        projectId,
        sourcePort: event.sourcePort ?? null,
        destinationPort: event.destinationPort ?? null,
        occurredAt: event.occurredAt.toISOString(),
      },
    });
  }
  const heartbeat = inserted.find((event) => event.eventType === "AGENT_HEARTBEAT");
  if (heartbeat) {
    emitProjectRealtime(projectId, {
      name: "agent:status",
      payload: {
        projectId,
        agentId,
        status: "ONLINE",
        lastHeartbeatAt: new Date().toISOString(),
      },
    });
  }
  // Only committed, newly inserted events trigger detection. Retries do not reprocess duplicates.
  await detectEventsService(projectId, inserted.map((event) => event.id));
  return { insertedCount: inserted.length, duplicateCount: events.length - inserted.length };
};
