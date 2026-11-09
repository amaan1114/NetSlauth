import { and, eq, isNull } from "drizzle-orm";
import { agents, networkEvents } from "@workspace/netsleuth-database";
import type { NetworkEventInput } from "@workspace/netsleuth-shared";
import { db } from "../../services/database.js";
import { HttpError } from "../../utils/HttpError.js";

export const ingestEventsService = async (agentId: string, projectId: string, events: NetworkEventInput[]) => {
  return db.transaction(async (transaction) => {
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
      .returning({ eventType: networkEvents.eventType });

    if (inserted.some((event) => event.eventType === "AGENT_HEARTBEAT")) {
      await transaction.update(agents).set({ status: "ONLINE", lastHeartbeatAt: new Date() })
        .where(eq(agents.id, agent.id));
    }
    return { insertedCount: inserted.length, duplicateCount: events.length - inserted.length };
  });
};
