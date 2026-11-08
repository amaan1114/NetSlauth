import { sql } from "drizzle-orm";
import { check, index, inet, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

export const networkEvents = pgTable("network_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  sourceIp: inet("source_ip").notNull(),
  sourcePort: integer("source_port"),
  destinationIp: inet("destination_ip").notNull(),
  destinationPort: integer("destination_port"),
  protocol: text("protocol").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("network_events_agent_event_unique").on(table.agentId, table.eventId),
  index("network_events_agent_time_idx").on(table.agentId, table.occurredAt.desc()),
  index("network_events_type_time_idx").on(table.eventType, table.occurredAt.desc()),
  index("network_events_occurred_at_idx").on(table.occurredAt.desc()),
  index("network_events_source_time_idx").on(table.sourceIp, table.occurredAt.desc()),
  index("network_events_destination_time_idx").on(table.destinationIp, table.occurredAt.desc()),
  check("network_events_source_port_range", sql`${table.sourcePort} BETWEEN 0 AND 65535`),
  check("network_events_destination_port_range", sql`${table.destinationPort} BETWEEN 0 AND 65535`),
  check("network_events_event_id_not_empty", sql`length(trim(${table.eventId})) > 0`),
  check("network_events_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
]);

export type NetworkEvent = typeof networkEvents.$inferSelect;
export type NewNetworkEvent = typeof networkEvents.$inferInsert;
