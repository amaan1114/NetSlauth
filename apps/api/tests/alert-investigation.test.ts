import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, users, workspaces, workspaceMembers, projects, agents, networkEvents, securityAlerts } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_INVESTIGATION_TESTS");

test("alert investigation, filters, related evidence and explicit lifecycle", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `investigation_${randomUUID().replaceAll("-", "")}`;
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
          { name: "Alerts", workspaceId: workspace.id }, { name: "Empty", workspaceId: workspace.id },
          { name: "Foreign", workspaceId: foreignWorkspace.id },
        ]).returning();
        assert.ok(project && empty && foreign);
        const [agent, foreignAgent, siblingAgent] = await tx.insert(agents).values([
          { projectId: project.id, name: "Sensor", apiKeyHash: "hidden-test-hash" },
          { projectId: foreign.id, name: "Foreign sensor" },
          { projectId: project.id, name: "Same-project sensor" },
        ]).returning();
        assert.ok(agent && foreignAgent && siblingAgent);
        const publicId = randomUUID();
        const [event, foreignEvent, siblingEvent, secondEvent] = await tx.insert(networkEvents).values(
          [agent.id, foreignAgent.id, siblingAgent.id, agent.id].map((agentId, index) => ({
            agentId, eventId: index < 3 ? publicId : randomUUID(), eventType: "AUTHENTICATION_FAILURE",
            sourceIp: "2001:db8::1", destinationIp: "192.0.2.2", protocol: "TCP",
            occurredAt: new Date(`2026-11-10T10:00:0${index}Z`),
          })),
        ).returning();
        assert.ok(event && foreignEvent && siblingEvent && secondEvent);
        const base = {
          projectId: project.id, title: "Test reported behavior", description: "Not proof of malicious activity.",
          severity: "HIGH" as const, ruleId: "auth_failure_burst",
          firstSeenAt: new Date("2026-11-10T10:00:00Z"), lastSeenAt: new Date("2026-11-10T10:01:00Z"),
        };
        const [authentication, database, noEvidence, foreignAlert] = await tx.insert(securityAlerts).values([
          { ...base, fingerprint: randomUUID(), evidence: { sourceIp: "2001:db8::1", destinationIp: "192.0.2.2",
            threshold: 5, failureCount: 5, windowSeconds: 60,
            events: [
              { id: event.id, agentId: agent.id, eventId: event.eventId, occurredAt: event.occurredAt.toISOString() },
              { id: secondEvent.id, agentId: agent.id, eventId: secondEvent.eventId },
              { id: foreignEvent.id, agentId: foreignAgent.id },
              { id: siblingEvent.id, agentId: agent.id },
            ], nested: { token: "test-only-secret", safe: true } } },
          { ...base, agentId: agent.id, fingerprint: randomUUID(), severity: "MEDIUM", ruleId: "database_destination",
            lastSeenAt: new Date("2026-11-10T10:02:00Z"), evidence: { eventId: publicId, databasePolicy: { databasePorts: [5432], allowedDestinations: [] } } },
          { ...base, fingerprint: randomUUID(), status: "ACKNOWLEDGED", evidence: { events: "malformed legacy evidence" } },
          { ...base, projectId: foreign.id, fingerprint: randomUUID() },
        ]).returning();
        assert.ok(authentication && database && noEvidence && foreignAlert);
        const app = createApp(async () => {});
        const cookie = (id: string) => `netsleuth_access=${signToken(id, "access", 900)}`;
        const path = `/api/v1/projects/${project.id}/alerts`;
        const get = (suffix = "", id = owner.id) => request(app).get(`${path}${suffix}`).set("Cookie", cookie(id));
        const patch = (alertId: string, status: string, id = owner.id) => request(app)
          .patch(`${path}/${alertId}/status`).set("Cookie", cookie(id)).send({ status });

        await t.test("stable bounded pages and combined severity/status/rule/IP/last-seen filters", async () => {
          const first = await get("?limit=1");
          assert.equal(first.status, 200);
          assert.equal(first.body.data.alerts[0].id, database.id);
          assert.deepEqual(first.body.data.pagination, { page: 1, limit: 1, hasMore: true });
          const second = await get("?limit=1&page=2");
          assert.notEqual(second.body.data.alerts[0].id, database.id);
          const last = await get("?limit=1&page=3");
          assert.equal(last.body.data.pagination.hasMore, false);
          const query = new URLSearchParams({ severity: "HIGH", status: "OPEN", ruleId: "auth_failure_burst",
            sourceIp: "2001:0db8:0:0:0:0:0:1", start: "2026-11-10T10:01:00Z", end: "2026-11-10T10:02:00Z" });
          assert.deepEqual((await get(`?${query}`)).body.data.alerts.map((row: { id: string }) => row.id), [authentication.id]);
          assert.deepEqual((await get("?end=2026-11-10T10:01:00Z")).body.data.alerts, []);
          assert.equal(first.headers["cache-control"], "no-store");
        });

        await t.test("detail preserves real evidence, safely redacts and handles nullable agent", async () => {
          const detail = await get(`/${authentication.id}`);
          assert.equal(detail.status, 200);
          assert.equal(detail.body.data.agent, null);
          assert.equal(detail.body.data.alert.evidence.failureCount, 5);
          assert.deepEqual(detail.body.data.alert.evidence.nested, { token: "[Redacted]", safe: true });
          const dbDetail = await get(`/${database.id}`);
          assert.deepEqual(dbDetail.body.data.agent, { id: agent.id, name: "Sensor" });
          assert.equal(JSON.stringify(dbDetail.body).includes("hidden-test-hash"), false);
          assert.equal((await get(`/${foreignAlert.id}`)).status, 404);
        });

        await t.test("related references are bounded, same-project and bound to the correct agent", async () => {
          const related = await get(`/${authentication.id}/events?limit=1`);
          assert.equal(related.status, 200);
          assert.equal(related.body.data.events[0].id, secondEvent.id);
          assert.equal(related.body.data.pagination.hasMore, true);
          const next = await get(`/${authentication.id}/events?limit=1&page=2`);
          assert.equal(next.body.data.events[0].id, event.id);
          assert.equal(next.body.data.pagination.hasMore, false);
          const single = await get(`/${database.id}/events`);
          assert.deepEqual(single.body.data.events.map((row: { id: string }) => row.id), [event.id]);
          assert.deepEqual((await get(`/${noEvidence.id}/events`)).body.data.events, []);
          assert.equal((await get(`/${foreignAlert.id}/events`)).status, 404);
        });

        await t.test("member status writes persist without modifying observation evidence or other projects", async () => {
          for (const status of ["ACKNOWLEDGED", "RESOLVED", "OPEN"]) {
            const response = await patch(authentication.id, status, member.id);
            assert.equal(response.status, 200);
            assert.equal(response.body.data.alert.status, status);
            assert.equal(response.body.data.alert.firstSeenAt, authentication.firstSeenAt.toISOString());
            assert.equal(response.body.data.alert.lastSeenAt, authentication.lastSeenAt.toISOString());
            assert.equal((await get(`/${authentication.id}`)).body.data.alert.status, status);
          }
          const [stored] = await tx.select().from(securityAlerts).where(eq(securityAlerts.id, authentication.id));
          assert.deepEqual(stored!.evidence, authentication.evidence);
          assert.equal((await patch(authentication.id, "RESOLVED", outsider.id)).status, 404);
          assert.equal((await patch(foreignAlert.id, "RESOLVED")).status, 404);
          assert.equal((await get("", outsider.id)).status, 404);
          assert.equal((await get(`/${authentication.id}`, outsider.id)).status, 404);
          assert.equal((await get(`/${authentication.id}/events`, outsider.id)).status, 404);
          assert.equal((await request(app).patch(`${path}/${authentication.id}/status`).send({ status: "RESOLVED" })).status, 401);
          assert.equal((await request(app).get(path).set("Authorization", `Bearer ${signToken(owner.id, "access", 900)}`)).status, 401);
        });

        await t.test("empty and invalid filters/body/IDs fail explicitly", async () => {
          assert.deepEqual((await request(app).get(`/api/v1/projects/${empty.id}/alerts`).set("Cookie", cookie(owner.id))).body.data.alerts, []);
          for (const query of ["sourceIp=bad", "sourceIp=fe80::1%25eth0", "ruleId=", "start=bad", "limit=101", "status=BAD",
            "start=2026-11-11T00:00:00Z&end=2026-11-10T00:00:00Z", "severity=HIGH&severity=LOW"]) {
            assert.equal((await get(`?${query}`)).status, 400, query);
          }
          assert.equal((await patch(authentication.id, "BAD")).status, 400);
          assert.equal((await request(app).patch(`${path}/${authentication.id}/status`).set("Cookie", cookie(owner.id))
            .send({ status: "OPEN", evidence: {} })).status, 400);
          assert.equal((await get("/bad")).status, 400);
          assert.equal((await get(`/${authentication.id}/events?limit=101`)).status, 400);
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
