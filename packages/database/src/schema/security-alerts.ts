import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { projects } from "./projects.js";

export const alertSeverity = pgEnum("alert_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const alertStatus = pgEnum("alert_status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]);

export const securityAlerts = pgTable("security_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: alertSeverity("severity").notNull(),
  status: alertStatus("status").default("OPEN").notNull(),
  ruleId: text("rule_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  foreignKey({
    name: "security_alerts_agent_project_fk",
    columns: [table.agentId, table.projectId],
    foreignColumns: [agents.id, agents.projectId],
  }).onDelete("cascade"),
  unique("security_alerts_project_fingerprint_unique").on(table.projectId, table.fingerprint),
  index("security_alerts_project_status_severity_idx").on(table.projectId, table.status, table.severity),
  index("security_alerts_project_last_seen_idx").on(table.projectId, table.lastSeenAt.desc()),
  index("security_alerts_agent_idx").on(table.agentId),
  check("security_alerts_seen_order", sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
  check("security_alerts_fingerprint_not_empty", sql`length(trim(${table.fingerprint})) > 0`),
  check("security_alerts_evidence_object", sql`jsonb_typeof(${table.evidence}) = 'object'`),
]);

export type SecurityAlert = typeof securityAlerts.$inferSelect;
export type NewSecurityAlert = typeof securityAlerts.$inferInsert;
