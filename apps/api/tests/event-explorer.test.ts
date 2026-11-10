import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createDatabase, users, workspaces, workspaceMembers, projects, agents, networkEvents } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_EXPLORER_TESTS");

test("project event explorer against isolated PostgreSQL", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `explorer_test_${randomUUID().replaceAll("-", "")}`;
  try {
    try {
      await drizzle(client, { schema }).transaction(async (tx) => {
        await tx.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", pg_catalog`));
        const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
        for (const file of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
          await tx.execute(sql.raw((await readFile(new URL(file, directory), "utf8")).replaceAll('"public".', `"${schemaName}".`)));
        }
        for (const method of ["select", "insert", "update", "delete", "transaction"] as const) {
          t.mock.method(db, method, tx[method].bind(tx));
        }
        const [owner, outsider, member] = await tx.insert(users).values(["Owner", "Outsider", "Member"].map((name) => ({
          name, email: `${randomUUID()}@example.invalid`, passwordHash: "test-only",
        }))).returning();
        assert.ok(owner && outsider && member);
        const [workspace, foreignWorkspace] = await tx.insert(workspaces).values([{ name: "Owned" }, { name: "Foreign" }]).returning();
        assert.ok(workspace && foreignWorkspace);
        await tx.insert(workspaceMembers).values([
          { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
          { userId: member.id, workspaceId: workspace.id, role: "MEMBER" },
          { userId: outsider.id, workspaceId: foreignWorkspace.id, role: "OWNER" },
        ]);
        const [project, empty, foreign] = await tx.insert(projects).values([
          { name: "Events", workspaceId: workspace.id },
          { name: "Empty", workspaceId: workspace.id },
          { name: "Foreign", workspaceId: foreignWorkspace.id },
        ]).returning();
        assert.ok(project && empty && foreign);
        const [agent, otherAgent, foreignAgent] = await tx.insert(agents).values([
          { projectId: project.id, name: "Sensor", apiKeyHash: "never-expose-this-hash" },
          { projectId: project.id, name: "Other sensor" },
          { projectId: foreign.id, name: "Foreign sensor" },
        ]).returning();
        assert.ok(agent && otherAgent && foreignAgent);
        const time = new Date("2026-11-10T10:00:00Z");
        const seed = (agentId: string, index: number) => ({
          agentId, eventId: randomUUID(), eventType: "NETWORK_CONNECTION_ESTABLISHED",
          sourceIp: "192.0.2.1", sourcePort: 0, destinationIp: "2001:db8::2",
          destinationPort: null, protocol: "TCP", occurredAt: new Date(time.getTime() + index * 1000),
          metadata: { state: "ESTAB", nested: { authorization: "never-show", label: "safe" }, password: "hidden" },
        });
        const rows = await tx.insert(networkEvents).values([
          ...Array.from({ length: 7 }, (_, index) => seed(agent.id, index)),
          { ...seed(otherAgent.id, 7), protocol: "UDP", eventType: "SERVICE_DISCOVERED", sourceIp: "2001:db8::1" },
          { ...seed(agent.id, 7), eventType: "AUTHENTICATION_FAILURE", protocol: "OTHER" },
          seed(foreignAgent.id, 100),
        ]).returning();
        const app = createApp(async () => {});
        const cookie = (id: string) => `netsleuth_access=${signToken(id, "access", 900)}`;
        const path = `/api/v1/projects/${project.id}/events`;
        const get = (suffix = "", id = owner.id) => request(app).get(`${path}${suffix}`).set("Cookie", cookie(id));

        await t.test("bounded stable newest-first pages exclude foreign events and metadata", async () => {
          const all: string[] = [];
          for (const offset of [0, 3, 6]) {
            const response = await get(`?limit=3&offset=${offset}`);
            assert.equal(response.status, 200);
            assert.equal(response.headers["cache-control"], "no-store");
            assert.equal(response.body.data.events.length, 3);
            assert.deepEqual(response.body.data.pagination, { limit: 3, offset, hasMore: offset < 6 });
            all.push(...response.body.data.events.map((row: { id: string }) => row.id));
            for (const row of response.body.data.events) {
              assert.equal(row.projectId, project.id);
              assert.equal(row.metadata, undefined);
              assert.equal(row.apiKeyHash, undefined);
            }
          }
          const expected = rows.filter((row) => row.agentId !== foreignAgent.id)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id)).map((row) => row.id);
          assert.deepEqual(all, expected);
          assert.equal(new Set(all).size, 9);
          assert.deepEqual((await get("?offset=9")).body.data.events, []);
        });

        await t.test("all filters combine in SQL, IPv4/IPv6 equality and half-open times", async () => {
          const query = new URLSearchParams({
            eventType: "NETWORK_CONNECTION_ESTABLISHED", protocol: "TCP",
            sourceIp: "192.0.2.1", destinationIp: "2001:0db8:0:0:0:0:0:2",
            agentId: agent.id, start: "2026-11-10T10:00:02Z", end: "2026-11-10T10:00:04Z",
          });
          const response = await get(`?${query}`);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data.events.map((row: { id: string }) => row.id), [rows[3]!.id, rows[2]!.id]);
          assert.equal(response.body.data.events[0].sourcePort, 0);
          assert.equal(response.body.data.events[0].destinationPort, null);
          const ipv6 = await get("?sourceIp=2001:0db8::1&protocol=UDP&eventType=SERVICE_DISCOVERED");
          assert.equal(ipv6.body.data.events.length, 1);
          assert.equal(ipv6.body.data.events[0].agentId, otherAgent.id);
          assert.deepEqual((await get(`?agentId=${foreignAgent.id}`)).body.data.events, []);
          assert.deepEqual((await get("?protocol=TCP&sourceIp=192.0.2.99")).body.data.events, []);
        });

        await t.test("scoped detail returns evidence safely and redacts nested credentials", async () => {
          const detail = await get(`/${rows[0]!.id}`);
          assert.equal(detail.status, 200);
          const event = detail.body.data.event;
          assert.equal(event.eventId, rows[0]!.eventId);
          assert.equal(event.receivedAt, rows[0]!.receivedAt.toISOString());
          assert.deepEqual(event.metadata, { state: "ESTAB", nested: { authorization: "[Redacted]", label: "safe" }, password: "[Redacted]" });
          assert.equal(JSON.stringify(detail.body).includes("never-expose-this-hash"), false);
          assert.equal((await get(`/${rows[9]!.id}`)).status, 404);
          assert.equal((await get(`/${randomUUID()}`)).status, 404);
        });

        await t.test("cookie auth and actual workspace membership gate both reads", async () => {
          assert.equal((await request(app).get(path)).status, 401);
          assert.equal((await request(app).get(path).set("Authorization", `Bearer ${signToken(owner.id, "access", 900)}`)).status, 401);
          assert.equal((await get("", outsider.id)).status, 404);
          assert.equal((await get(`/${rows[0]!.id}`, outsider.id)).status, 404);
          assert.equal((await get("", member.id)).status, 200);
          const emptyResponse = await request(app).get(`/api/v1/projects/${empty.id}/events`).set("Cookie", cookie(owner.id));
          assert.deepEqual(emptyResponse.body.data.events, []);
          assert.equal(emptyResponse.body.data.pagination.hasMore, false);
          assert.equal((await request(app).get(`/api/v1/projects/${foreign.id}/events`).set("Cookie", cookie(owner.id))).status, 404);
        });

        await t.test("invalid filters, limits, arrays, dates and identifiers return 400", async () => {
          for (const query of ["limit=0", "limit=101", "offset=-1", "offset=1000001", "protocol=ICMP", "eventType=FAKE",
            "agentId=invalid", "sourceIp=192.0", "sourceIp=192.0.2.0%2F24", "destinationIp=2001:bogus", "sourceIp=fe80::1%25eth0",
            "start=yesterday", "start=2026-11-11T00:00:00Z&end=2026-11-10T00:00:00Z",
            "start=2026-11-10T00:00:00Z&end=2026-11-10T00:00:00Z", "protocol=TCP&protocol=UDP", "unknown=1"]) {
            assert.equal((await get(`?${query}`)).status, 400, query);
          }
          assert.equal((await get("/invalid")).status, 400);
          assert.equal((await request(app).get("/api/v1/projects/invalid/events").set("Cookie", cookie(owner.id))).status, 400);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal((await client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schemaName])).rowCount, 0);
  } finally {
    client.release(true);
    await pool.end();
  }
});
