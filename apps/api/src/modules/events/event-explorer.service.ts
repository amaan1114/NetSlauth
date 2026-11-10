import type { ExplorerEventDetail, ExplorerEventList } from "@workspace/netsleuth-shared";
import { getProjectService } from "../projects/project.service.js";
import { HttpError } from "../../utils/HttpError.js";
import { findProjectEvent, listProjectEvents } from "./event-explorer.repo.js";
import type { EventQuery } from "./event-explorer.validation.js";

// Metadata is agent-supplied evidence, not a place to publish credentials.
// Preserve useful JSON while masking common sensitive keys and token formats.
export const redactEventMetadata = (value: unknown, depth = 0): unknown => {
  if (depth > 20) return "[Redacted: nesting limit]";
  if (Array.isArray(value)) return value.map((item) => redactEventMetadata(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /password|passwd|secret|token|cookie|authorization|credential|api.?key|private.?key|connection.?string/i.test(key)
        ? "[Redacted]"
        : redactEventMetadata(item, depth + 1),
    ]));
  }
  if (typeof value === "string") {
    return value
      .replace(/ns_agent_[a-f0-9]{64}/gi, "[Redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[Redacted]")
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "[Redacted]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[Redacted]@");
  }
  return value;
};

export const getProjectEventsService = async (
  userId: string, projectId: string, query: EventQuery,
): Promise<ExplorerEventList> => {
  await getProjectService(userId, projectId);
  const rows = await listProjectEvents(projectId, query);
  return {
    events: rows.slice(0, query.limit).map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    pagination: { limit: query.limit, offset: query.offset, hasMore: rows.length > query.limit },
  };
};

export const getProjectEventService = async (
  userId: string, projectId: string, eventRecordId: string,
): Promise<{ event: ExplorerEventDetail }> => {
  await getProjectService(userId, projectId);
  const event = await findProjectEvent(projectId, eventRecordId);
  if (!event) throw new HttpError(404, "Event not found");
  return {
    event: {
      ...event,
      occurredAt: event.occurredAt.toISOString(),
      receivedAt: event.receivedAt.toISOString(),
      metadata: redactEventMetadata(event.metadata) as Record<string, unknown>,
    },
  };
};
