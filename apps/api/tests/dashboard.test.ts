import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  createDatabase, users, workspaces, workspaceMembers, projects, agents, networkEvents, securityAlerts,
} from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import type { DashboardActivity, DashboardSummary } from "@workspace/netsleuth-shared";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";
import { getDashboardActivityService } from "../src/modules/dashboard/dashboard.service.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_DASHBOARD_TESTS");

test("dashboard aggregates with isolated rollback-only PostgreSQL records", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `dashboard_test_${randomUUID().replaceAll("-", "")}`;
  try {
    try {
      await drizzle(client, { schema }).transaction(async (transaction) => {
        await transaction.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
        await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", pg_catalog`));
        const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
        for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
          const migration = await readFile(new URL(name, directory), "utf8");
          await transaction.execute(sql.raw(migration.replaceAll('"public".', `"${schemaName}".`)));
        }
        for (const method of ["select", "insert", "update", "delete", "transaction"] as const) {
          t.mock.method(db, method, transaction[method].bind(transaction));
        }
        const [owner, outsider, member] = await transaction.insert(users).values(
          ["Owner", "Outsider", "Member"].map((name) => ({
            name, email: `${randomUUID()}@example.invalid`, passwordHash: "unused-fixture",
          })),
        ).returning();
        assert.ok(owner && outsider && member);
        const [workspaceA, workspaceB] = await transaction.insert(workspaces)
          .values([{ name: "Dashboard A" }, { name: "Dashboard B" }]).returning();
        assert.ok(workspaceA && workspaceB);
        await transaction.insert(workspaceMembers).values([
          { workspaceId: workspaceA.id, userId: owner.id, role: "OWNER" },
          { workspaceId: workspaceA.id, userId: member.id, role: "MEMBER" },
          { workspaceId: workspaceB.id, userId: outsider.id, role: "OWNER" },
        ]);
        const [populated, empty, foreign, boundary] = await transaction.insert(projects).values([
          { workspaceId: workspaceA.id, name: "Populated" },
          { workspaceId: workspaceA.id, name: "Empty" },
          { workspaceId: workspaceB.id, name: "Foreign" },
          { workspaceId: workspaceA.id, name: "Boundary" },
        ]).returning();
        assert.ok(populated && empty && foreign && boundary);
        const now = new Date();
        const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
        const registered = await transaction.insert(agents).values(Array.from({ length: 12 }, (_, index) => ({
          projectId: populated.id, name: `Agent ${index}`,
          status: index === 0 ? "ONLINE" as const : index === 1 ? "OFFLINE" as const : "INACTIVE" as const,
          lastHeartbeatAt: index === 0 ? ago(7 * 24 * 60) : null,
          apiKeyHash: `private-hash-${index}`,
        }))).returning();
        const agent = registered[0]!;
        const [foreignAgent, boundaryAgent] = await transaction.insert(agents).values([
          { projectId: foreign.id, name: "Foreign agent", status: "ONLINE" },
          { projectId: boundary.id, name: "Boundary agent" },
        ]).returning();
        assert.ok(foreignAgent && boundaryAgent);
        const event = (agentId: string, eventType: string, occurredAt: Date) => ({
          agentId, eventId: randomUUID(), eventType, occurredAt,
          sourceIp: "192.0.2.10", destinationIp: "198.51.100.10", protocol: "TCP",
        });
        await transaction.insert(networkEvents).values([
          event(agent.id, "NETWORK_CONNECTION_ATTEMPT", ago(30)),
          event(agent.id, "NETWORK_CONNECTION_ESTABLISHED", ago(120)),
          event(agent.id, "AUTHENTICATION_FAILURE", ago(90)),
          event(agent.id, "AUTHENTICATION_SUCCESS", ago(5)),
          event(agent.id, "AGENT_HEARTBEAT", ago(10)),
          event(agent.id, "SERVICE_DISCOVERED", ago(180)),
          event(agent.id, "NETWORK_CONNECTION_ATTEMPT", ago(48 * 60)),
          event(agent.id, "NETWORK_CONNECTION_ATTEMPT", ago(-60)),
          event(foreignAgent.id, "NETWORK_CONNECTION_ATTEMPT", ago(5)),
        ]);
        const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
        const statuses = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
        await transaction.insert(securityAlerts).values(Array.from({ length: 11 }, (_, index) => ({
          projectId: populated.id, title: `Alert ${index}`, description: "Explicit test evidence",
          severity: severities[index % 4]!, status: statuses[index % 3]!,
          ruleId: "test_rule", fingerprint: randomUUID(),
          evidence: { sourceIp: index % 2 ? { invalid: true } : "192.0.2.10" },
          firstSeenAt: ago(20 - index), lastSeenAt: now,
        })));
        await transaction.insert(securityAlerts).values({
          projectId: foreign.id, title: "Foreign alert", description: "Isolation fixture",
          severity: "CRITICAL", ruleId: "test_rule", fingerprint: randomUUID(),
        });
        const app = createApp(async () => {});
        const cookie = (id: string) => `netsleuth_access=${signToken(id, "access", 900)}`;
        const path = (id: string) => `/api/v1/projects/${id}/dashboard`;
        const summary = async (id = populated.id, userId = owner.id) => {
          const response = await request(app).get(`${path(id)}/summary`).set("Cookie", cookie(userId));
          assert.equal(response.status, 200, JSON.stringify(response.body));
          return response.body.data as DashboardSummary;
        };
        const activity = async (range = "24h") => {
          const response = await request(app).get(`${path(populated.id)}/activity?range=${range}`).set("Cookie", cookie(owner.id));
          assert.equal(response.status, 200, JSON.stringify(response.body));
          return response.body.data as DashboardActivity;
        };
        const totals = (result: DashboardActivity) => result.buckets.reduce((sum, bucket) => ({
          network: sum.network + bucket.network, authentication: sum.authentication + bucket.authentication,
          heartbeat: sum.heartbeat + bucket.heartbeat, service: sum.service + bucket.service,
        }), { network: 0, authentication: 0, heartbeat: 0, service: 0 });

        await t.test("counts, severity and bounded recent lists match persisted records", async () => {
          const data = await summary();
          assert.deepEqual(data.metrics, {
            totalAgents: 12, onlineAgents: 1, offlineAgents: 1, inactiveAgents: 10,
            totalNetworkEvents: 8, openAlerts: 4, criticalAlerts: 3,
          });
          assert.deepEqual(data.severityDistribution, { CRITICAL: 3, HIGH: 3, MEDIUM: 3, LOW: 2 });
          assert.equal(data.recentAlerts.length, 8);
          assert.equal(data.recentAlerts[0]!.title, "Alert 10");
          assert.equal(data.recentAlerts[0]!.sourceIp, "192.0.2.10");
          assert.equal(data.recentAlerts[1]!.sourceIp, null);
          assert.equal(data.agentHealth.items.length, 10);
          assert.equal(data.agentHealth.hasMore, true);
          assert.ok(data.agentHealth.items.every((item) => item.projectId === populated.id));
          assert.ok(data.recentAlerts.every((item) => item.projectId === populated.id));
          assert.equal(JSON.stringify(data).includes("private-hash"), false);
          const response = await request(app).get(`${path(populated.id)}/summary`).set("Cookie", cookie(owner.id));
          assert.equal(response.headers["cache-control"], "no-store");
        });
        await t.test("stored ONLINE is not inferred from existence or changed by dashboard reads", async () => {
          const [stored] = await transaction.select().from(agents).where(sql`${agents.id} = ${agent.id}`);
          assert.equal(stored?.status, "ONLINE");
          assert.equal(stored?.lastHeartbeatAt?.toISOString(), ago(7 * 24 * 60).toISOString());
        });
        await t.test("activity separates event categories and excludes out-of-window/foreign events", async () => {
          const day = await activity();
          assert.equal(day.buckets.length, 24);
          assert.equal(day.intervalMinutes, 60);
          assert.deepEqual(totals(day), { network: 2, authentication: 2, heartbeat: 1, service: 1 });
          assert.equal(new Date(day.to).getTime() - new Date(day.from).getTime(), 86_400_000);
          assert.equal(day.buckets[0]!.start, day.from);
          const hour = await activity("1h");
          assert.equal(hour.buckets.length, 12);
          assert.deepEqual(totals(hour), { network: 1, authentication: 1, heartbeat: 1, service: 0 });
          const week = await activity("7d");
          assert.equal(week.buckets.length, 28);
          assert.deepEqual(totals(week), { network: 3, authentication: 2, heartbeat: 1, service: 1 });
        });
        await t.test("exact range boundary is inclusive at start, exclusive at end", async () => {
          const from = new Date(now.getTime() - 3_600_000);
          await transaction.insert(networkEvents).values([
            event(boundaryAgent.id, "NETWORK_CONNECTION_ATTEMPT", from),
            event(boundaryAgent.id, "NETWORK_CONNECTION_ATTEMPT", new Date(from.getTime() - 1)),
            event(boundaryAgent.id, "NETWORK_CONNECTION_ATTEMPT", new Date(now.getTime() - 1)),
            event(boundaryAgent.id, "NETWORK_CONNECTION_ATTEMPT", now),
          ]);
          const result = await getDashboardActivityService(owner.id, boundary.id, "1h", now);
          assert.equal(result.buckets[0]!.network, 1);
          assert.equal(result.buckets.at(-1)!.network, 1);
          assert.equal(totals(result).network, 2);
        });
        await t.test("empty projects return zero metrics and zero-filled time buckets", async () => {
          const data = await summary(empty.id);
          assert.ok(Object.values(data.metrics).every((value) => value === 0));
          assert.deepEqual(data.recentAlerts, []);
          assert.deepEqual(data.agentHealth.items, []);
          assert.equal(data.agentHealth.hasMore, false);
          assert.ok(Object.values(data.severityDistribution).every((value) => value === 0));
          const response = await request(app).get(`${path(empty.id)}/activity`).set("Cookie", cookie(owner.id));
          assert.equal(response.status, 200);
          assert.ok((response.body.data as DashboardActivity).buckets.every((bucket) => bucket.network === 0 && bucket.authentication === 0));
        });
        await t.test("member access, tenant isolation, cookie-only auth and validation", async () => {
          assert.equal((await summary(populated.id, member.id)).metrics.totalAgents, 12);
          for (const endpoint of ["summary", "activity"]) {
            assert.equal((await request(app).get(`${path(populated.id)}/${endpoint}`)).status, 401);
            assert.equal((await request(app).get(`${path(populated.id)}/${endpoint}`).set("Authorization", `Bearer ${signToken(owner.id, "access", 900)}`)).status, 401);
            assert.equal((await request(app).get(`${path(foreign.id)}/${endpoint}`).set("Cookie", cookie(owner.id))).status, 404);
            assert.equal((await request(app).get(`${path(populated.id)}/${endpoint}`).set("Cookie", cookie(outsider.id))).status, 404);
            assert.equal((await request(app).get(`${path("bad-id")}/${endpoint}`).set("Cookie", cookie(owner.id))).status, 400);
          }
          for (const query of ["range=1y", "range=1h&range=7d", "projectId=other"]) {
            const response = await request(app).get(`${path(populated.id)}/activity?${query}`).set("Cookie", cookie(owner.id));
            assert.equal(response.status, 400);
          }
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remains = await client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schemaName]);
    assert.equal(remains.rowCount, 0);
  } finally {
    t.mock.restoreAll();
    client.release();
    await pool.end();
  }
});
