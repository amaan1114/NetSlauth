import { networkEventSchema, networkEventTypeSchema, networkProtocolSchema, type ExplorerEventList } from "@workspace/netsleuth-shared";

export interface EventFilters {
  eventType: string;
  protocol: string;
  sourceIp: string;
  destinationIp: string;
  agentId: string;
  start: string;
  end: string;
}

export interface EventListParams extends EventFilters {
  limit: number;
  offset: number;
}

export const EMPTY_EVENT_FILTERS: EventFilters = {
  eventType: "",
  protocol: "",
  sourceIp: "",
  destinationIp: "",
  agentId: "",
  start: "",
  end: "",
};

export function isExactIpAddress(value: string): boolean {
  return !value.includes("%") && networkEventSchema.shape.sourceIp.safeParse(value).success;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateEventFilters(filters: EventFilters): string[] {
  const errors: string[] = [];
  if (filters.eventType && !networkEventTypeSchema.safeParse(filters.eventType).success) errors.push("Choose a listed event type.");
  if (filters.protocol && !networkProtocolSchema.safeParse(filters.protocol).success) errors.push("Choose TCP, UDP, or OTHER.");
  if (filters.sourceIp && !isExactIpAddress(filters.sourceIp.trim())) errors.push("Source IP must be one complete IPv4 or IPv6 address.");
  if (filters.destinationIp && !isExactIpAddress(filters.destinationIp.trim())) errors.push("Destination IP must be one complete IPv4 or IPv6 address.");
  if (filters.agentId && !isUuid(filters.agentId.trim())) errors.push("Agent ID must be a complete UUID.");
  const start = filters.start ? new Date(filters.start) : null;
  const end = filters.end ? new Date(filters.end) : null;
  if (filters.start && (!start || Number.isNaN(start.getTime()))) errors.push("Enter a valid start time.");
  if (filters.end && (!end || Number.isNaN(end.getTime()))) errors.push("Enter a valid end time.");
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
    errors.push("End time must be later than start time.");
  }
  return errors;
}

export function makeEventListUrl(projectId: string, params: EventListParams): string {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit));
  query.set("offset", String(params.offset));
  for (const field of ["eventType", "protocol", "sourceIp", "destinationIp", "agentId"] as const) {
    const value = params[field].trim();
    if (value) query.set(field, value);
  }
  if (params.start) query.set("start", new Date(params.start).toISOString());
  if (params.end) query.set("end", new Date(params.end).toISOString());
  return `/api/v1/projects/${encodeURIComponent(projectId)}/events?${query.toString()}`;
}

export function eventListKey(projectId: string, params: EventListParams): string {
  return `${projectId}:${JSON.stringify(params)}`;
}

export function eventListIsUsable(value: ExplorerEventList, projectId: string): boolean {
  return value.events.every((event) => event.projectId === projectId);
}

export function formatEventDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

export function eventTypeLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
