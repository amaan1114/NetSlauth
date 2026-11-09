import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

export type DatabasePolicy = {
  databasePorts: number[];
  allowedDestinations: { ip: string; port: number; protocol: "TCP" | "UDP" }[];
};

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  databasePolicy: jsonb("database_policy").$type<DatabasePolicy>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index("projects_workspace_idx").on(table.workspaceId),
  check("projects_database_policy_object", sql`${table.databasePolicy} IS NULL OR jsonb_typeof(${table.databasePolicy}) = 'object'`),
]);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
