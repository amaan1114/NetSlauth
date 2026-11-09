import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import {
  createDatabase, users, workspaces, workspaceMembers, projects, agents, networkEvents, securityAlerts,
} from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";
import { AUTH_FAILURE_RULE_ID, DATABASE_CONNECTION_RULE_ID, detectEventsService } from "../src/modules/detections/detection.service.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_DETECTION_TESTS");

test("initial detection rules, policy configuration and alert authorization with isolated PostgreSQL", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `detect_test_${randomUUID().replaceAll("-", "")}`;
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
        const [owner, outsider, member, admin] = await transaction.insert(users).values(
          ["Owner", "Outsider", "Member", "Admin"].map((name) => ({
            name, email: `${randomUUID()}@example.invalid`, passwordHash: "unused-test-fixture",
          })),
        ).returning();
        assert.ok(owner && outsider && member && admin);
        const [workspaceA, workspaceB] = await transaction.insert(workspaces).values([{ name: "A" }, { name: "B" }]).returning();
        assert.ok(workspaceA && workspaceB);
        await transaction.insert(workspaceMembers).values([
          { workspaceId: workspaceA.id, userId: owner.id, role: "OWNER" },
          { workspaceId: workspaceA.id, userId: member.id, role: "MEMBER" },
          { workspaceId: workspaceA.id, userId: admin.id, role: "ADMIN" },
          { workspaceId: workspaceB.id, userId: outsider.id, role: "OWNER" },
        ]);
        const [projectA, projectB] = await transaction.insert(projects).values([
          { name: "A", workspaceId: workspaceA.id }, { name: "B", workspaceId: workspaceB.id },
        ]).returning();
        assert.ok(projectA && projectB);
        const keys = Array.from({ length: 3 }, () => `ns_agent_${randomBytes(32).toString("hex")}`);
        const [agentA, agentB, agentA2] = await transaction.insert(agents).values([
          { name: "A", projectId: projectA.id, apiKeyHash: createHash("sha256").update(keys[0]!).digest("hex") },
          { name: "B", projectId: projectB.id, apiKeyHash: createHash("sha256").update(keys[1]!).digest("hex") },
          { name: "A2", projectId: projectA.id, apiKeyHash: createHash("sha256").update(keys[2]!).digest("hex") },
        ]).returning();
        assert.ok(agentA && agentB && agentA2);
        const app = createApp(async () => {});
        const cookie = (id: string) => `netsleuth_access=${signToken(id, "access", 900)}`;
        const policyPath = `/api/v1/projects/${projectA.id}/database-policy`;
        const alertsPath = `/api/v1/projects/${projectA.id}/alerts`;
        const occurredAt = (seconds: number) => new Date(Date.UTC(2026, 10, 9, 7, 0, seconds)).toISOString();
        const event = (sourceIp: string, seconds = 0, eventType = "AUTHENTICATION_FAILURE") => ({
          eventId: randomUUID(), eventType, sourceIp,
          destinationIp: "198.51.100.10", destinationPort: 5432,
          protocol: "TCP", occurredAt: occurredAt(seconds),
        });
        const ingest = (body: unknown, agentIndex = 0) => request(app).post("/api/v1/ingest/events")
          .set("X-Agent-Key", keys[agentIndex]!).send(body);
        const alerts = (projectId = projectA.id) => transaction.select().from(securityAlerts)
          .where(eq(securityAlerts.projectId, projectId));
        const ruleAlerts = async (ruleId: string, sourceIp: string) => (await alerts()).filter((alert) =>
          alert.ruleId === ruleId && alert.evidence.sourceIp === sourceIp);
        let failureAlertId = "";

        await t.test("four failures do not alert; the fifth creates HIGH evidence for one pair", async () => {
          assert.equal((await ingest([0, 10, 20, 30].map((time) => event("192.0.2.1", time)))).status, 200);
          assert.equal((await alerts()).length, 0);
          assert.equal((await ingest(event("192.0.2.1", 40))).status, 200);
          const [alert] = await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.1");
          assert.ok(alert);
          failureAlertId = alert.id;
          assert.equal(alert.severity, "HIGH");
          assert.equal(alert.status, "OPEN");
          assert.equal(alert.agentId, null);
          assert.equal(alert.evidence.failureCount, 5);
          assert.equal(alert.evidence.windowSeconds, 60);
          assert.equal(alert.evidence.destinationIp, "198.51.100.10");
          assert.equal((alert.evidence.eventIds as string[]).length, 5);
          assert.equal(alert.firstSeenAt.toISOString(), occurredAt(0));
          assert.equal(alert.lastSeenAt.toISOString(), occurredAt(40));
        });

        await t.test("different sources, destinations and projects are not combined", async () => {
          await ingest([0, 10, 20].map((time) => event("192.0.2.2", time)));
          await ingest([0, 10].map((time) => event("192.0.2.3", time)));
          await ingest([
            ...[0, 10, 20].map((time) => event("192.0.2.4", time)),
            ...[0, 10].map((time) => ({ ...event("192.0.2.4", time), destinationIp: "198.51.100.11" })),
          ]);
          await ingest([0, 10, 20, 30].map((time) => event("192.0.2.5", time)));
          await ingest(event("192.0.2.5", 40), 1);
          for (const ip of ["192.0.2.2", "192.0.2.3", "192.0.2.4", "192.0.2.5"]) {
            assert.equal((await ruleAlerts(AUTH_FAILURE_RULE_ID, ip)).length, 0);
          }
          assert.equal((await alerts(projectB.id)).length, 0);
        });

        await t.test("events outside 60 seconds and connection attempts never count as failures", async () => {
          await ingest([0, 10, 20, 30, 61].map((time) => event("192.0.2.6", time)));
          await ingest([
            ...[0, 10, 20, 30].map((time) => event("192.0.2.7", time)),
            event("192.0.2.7", 40, "NETWORK_CONNECTION_ATTEMPT"),
            event("192.0.2.7", 45, "AUTHENTICATION_SUCCESS"),
          ]);
          assert.equal((await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.6")).length, 0);
          assert.equal((await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.7")).length, 0);
        });

        await t.test("rolling boundary, late arrivals and same-project multi-agent evidence work", async () => {
          await ingest([0, 15, 30, 45, 60].map((time) => event("192.0.2.8", time)));
          assert.equal((await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.8")).length, 1);
          await ingest([0, 20, 30, 40].map((time) => event("192.0.2.9", time)));
          await ingest(event("192.0.2.9", 10), 2);
          const [late] = await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.9");
          assert.ok(late);
          assert.equal(late.evidence.failureCount, 5);
          assert.equal(late.lastSeenAt.toISOString(), occurredAt(40));
          const evidence = late.evidence.events as { agentId: string }[];
          assert.deepEqual([...new Set(evidence.map((item) => item.agentId))].sort(), [agentA.id, agentA2.id].sort());
        });

        await t.test("fresh failures update one alert without changing firstSeenAt; replay stays deduplicated", async () => {
          const sixth = event("192.0.2.1", 50);
          await ingest(sixth);
          const [before] = await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.1");
          assert.ok(before);
          assert.equal(before.id, failureAlertId);
          assert.equal(before.firstSeenAt.toISOString(), occurredAt(0));
          assert.equal(before.lastSeenAt.toISOString(), occurredAt(50));
          assert.equal(before.evidence.failureCount, 6);
          const duplicate = await ingest(sixth);
          assert.deepEqual(duplicate.body.data, { insertedCount: 0, duplicateCount: 1 });
          const [after] = await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.1");
          assert.equal(after?.updatedAt.getTime(), before.updatedAt.getTime(), "Duplicate ingestion ran detection");
          const stored = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, sixth.eventId));
          await detectEventsService(projectA.id, stored.map((row) => row.id));
          await detectEventsService(projectA.id, stored.map((row) => row.id));
          assert.equal((await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.1")).length, 1);
          const [reprocessed] = await ruleAlerts(AUTH_FAILURE_RULE_ID, "192.0.2.1");
          assert.equal(reprocessed?.firstSeenAt.getTime(), before.firstSeenAt.getTime());
          const otherBefore = (await alerts(projectB.id)).length;
          await detectEventsService(projectB.id, stored.map((row) => row.id));
          assert.equal((await alerts(projectB.id)).length, otherBefore);
        });

        await t.test("policy defaults to disabled and only OWNER/ADMIN can configure it", async () => {
          const initial = await request(app).get(policyPath).set("Cookie", cookie(member.id));
          assert.equal(initial.status, 200);
          assert.equal(initial.body.data.databasePolicy, null);
          await ingest(event("192.0.2.20", 0, "NETWORK_CONNECTION_ESTABLISHED"));
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.20")).length, 0);
          const policy = {
            databasePorts: [5432],
            allowedDestinations: [{ ip: "198.51.100.10", port: 5432, protocol: "TCP" }],
          };
          assert.equal((await request(app).put(policyPath).set("Cookie", cookie(member.id)).send({ databasePolicy: policy })).status, 403);
          assert.equal((await request(app).put(policyPath).set("Cookie", cookie(outsider.id)).send({ databasePolicy: policy })).status, 404);
          assert.equal((await request(app).put(policyPath).set("Cookie", cookie(admin.id)).send({ databasePolicy: policy })).status, 200);
          const read = await request(app).get(policyPath).set("Cookie", cookie(owner.id));
          assert.deepEqual(read.body.data.databasePolicy, policy);
        });

        await t.test("allowed destinations do not alert; unconfigured destinations produce MEDIUM evidence", async () => {
          await ingest(event("192.0.2.21", 0, "NETWORK_CONNECTION_ATTEMPT"));
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.21")).length, 0);
          const disallowed = { ...event("192.0.2.22", 0, "NETWORK_CONNECTION_ATTEMPT"), destinationIp: "198.51.100.99" };
          const response = await ingest(disallowed);
          assert.equal(response.status, 200);
          const [alert] = await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22");
          assert.ok(alert);
          assert.equal(alert.severity, "MEDIUM");
          assert.equal(alert.agentId, agentA.id);
          assert.equal(alert.evidence.destinationIp, disallowed.destinationIp);
          assert.equal(alert.evidence.destinationPort, 5432);
          assert.equal(alert.evidence.protocol, "TCP");
          assert.equal(alert.evidence.eventId, disallowed.eventId);
          assert.equal(alert.evidence.observation, "connection_attempt");
          assert.ok(alert.evidence.databasePolicy);
          assert.match(alert.description, /does not prove a successful database login/);
          await ingest(disallowed);
          const next = { ...disallowed, eventId: randomUUID(), occurredAt: occurredAt(10) };
          await ingest(next);
          const [updated] = await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22");
          assert.ok(updated);
          assert.equal(updated.id, alert.id);
          assert.equal(updated.firstSeenAt.getTime(), alert.firstSeenAt.getTime());
          assert.equal(updated.lastSeenAt.toISOString(), occurredAt(10));
          assert.equal(updated.evidence.eventId, next.eventId);
          const [persisted] = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, next.eventId));
          assert.ok(persisted);
          await detectEventsService(projectA.id, [persisted.id]);
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22")).length, 1);
        });

        await t.test("nonconnection events, missing ports, OTHER protocol and unwatched ports are skipped", async () => {
          const source = "192.0.2.23";
          const input = { ...event(source, 0, "NETWORK_CONNECTION_ESTABLISHED"), destinationIp: "198.51.100.99" };
          const { destinationPort, ...withoutPort } = input;
          assert.ok(destinationPort);
          await ingest([
            { ...input, eventId: randomUUID(), eventType: "SERVICE_DISCOVERED" },
            { ...input, eventId: randomUUID(), eventType: "AUTHENTICATION_SUCCESS" },
            { ...input, eventId: randomUUID(), protocol: "OTHER" },
            { ...input, eventId: randomUUID(), destinationPort: 443 },
            { ...withoutPort, eventId: randomUUID() },
          ]);
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, source)).length, 0);
        });

        await t.test("IPv6 allowlists normalize equivalent addresses; empty allowlist denies monitored ports", async () => {
          const policy = {
            databasePorts: [5432],
            allowedDestinations: [{ ip: "2001:0db8:0000:0000:0000:0000:0000:0001", port: 5432, protocol: "TCP" }],
          };
          assert.equal((await request(app).put(policyPath).set("Cookie", cookie(owner.id)).send({ databasePolicy: policy })).status, 200);
          await ingest({ ...event("192.0.2.24", 0, "NETWORK_CONNECTION_ESTABLISHED"), destinationIp: "2001:db8::1" });
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.24")).length, 0);
          await request(app).put(policyPath).set("Cookie", cookie(owner.id)).send({
            databasePolicy: { databasePorts: [5432], allowedDestinations: [] },
          });
          await ingest(event("192.0.2.25", 0, "NETWORK_CONNECTION_ESTABLISHED"));
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.25")).length, 1);
          await request(app).put(policyPath).set("Cookie", cookie(owner.id)).send({ databasePolicy: null });
          await ingest(event("192.0.2.26", 0, "NETWORK_CONNECTION_ATTEMPT"));
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.26")).length, 0);
        });

        await t.test("old observations cannot regress lastSeenAt; resolved alerts remain resolved", async () => {
          const [alert] = await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22");
          assert.ok(alert);
          await request(app).put(policyPath).set("Cookie", cookie(owner.id)).send({
            databasePolicy: { databasePorts: [5432], allowedDestinations: [] },
          });
          await ingest({ ...event("192.0.2.22", -10, "NETWORK_CONNECTION_ATTEMPT"), destinationIp: "198.51.100.99" });
          const [unchanged] = await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22");
          assert.equal(unchanged?.lastSeenAt.getTime(), alert.lastSeenAt.getTime());
          await transaction.update(securityAlerts).set({ status: "RESOLVED" }).where(eq(securityAlerts.id, alert.id));
          await ingest({ ...event("192.0.2.22", 20, "NETWORK_CONNECTION_ATTEMPT"), destinationIp: "198.51.100.99" });
          const [resolved] = await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.22");
          assert.equal(resolved?.status, "RESOLVED");
          assert.equal(resolved?.lastSeenAt.getTime(), alert.lastSeenAt.getTime());
        });

        await t.test("alert API is member-authorized with stable pagination and severity/status filters", async () => {
          assert.equal((await request(app).get(alertsPath)).status, 401);
          assert.equal((await request(app).get(alertsPath).set("X-Agent-Key", keys[0]!)).status, 401);
          assert.equal((await request(app).get(alertsPath).set("Cookie", cookie(outsider.id))).status, 404);
          const first = await request(app).get(`${alertsPath}?limit=2`).set("Cookie", cookie(member.id));
          assert.equal(first.status, 200);
          assert.equal(first.body.data.alerts.length, 2);
          assert.deepEqual(first.body.data.pagination, { page: 1, limit: 2, hasMore: true });
          const second = await request(app).get(`${alertsPath}?page=2&limit=2`).set("Cookie", cookie(owner.id));
          assert.equal(second.status, 200);
          const firstIds = first.body.data.alerts.map((alert: { id: string }) => alert.id);
          assert.equal(second.body.data.alerts.some((alert: { id: string }) => firstIds.includes(alert.id)), false);
          const high = await request(app).get(`${alertsPath}?severity=HIGH&status=OPEN`).set("Cookie", cookie(owner.id));
          assert.ok(high.body.data.alerts.length > 0);
          assert.ok(high.body.data.alerts.every((alert: { severity: string; status: string; projectId: string }) =>
            alert.severity === "HIGH" && alert.status === "OPEN" && alert.projectId === projectA.id));
          const resolved = await request(app).get(`${alertsPath}?severity=MEDIUM&status=RESOLVED`).set("Cookie", cookie(owner.id));
          assert.equal(resolved.body.data.alerts.length, 1);
          const empty = await request(app).get(`/api/v1/projects/${projectB.id}/alerts`).set("Cookie", cookie(outsider.id));
          assert.deepEqual(empty.body.data.alerts, []);
          assert.equal(empty.body.data.pagination.hasMore, false);
          assert.equal((await request(app).get(`/api/v1/projects/${projectB.id}/alerts`).set("Cookie", cookie(owner.id))).status, 404);
        });

        await t.test("policy/alert inputs and removed memberships fail without leaking project data", async () => {
          for (const query of ["limit=101", "page=0", "page=1.5", "severity=BAD", "status=BAD", "projectId=other"]) {
            assert.equal((await request(app).get(`${alertsPath}?${query}`).set("Cookie", cookie(owner.id))).status, 400);
          }
          for (const databasePolicy of [
            { databasePorts: [], allowedDestinations: [] },
            { databasePorts: [5432], allowedDestinations: [{ ip: "bad", port: 5432, protocol: "TCP" }] },
            { databasePorts: [5432], allowedDestinations: [{ ip: "192.0.2.1", port: 3306, protocol: "TCP" }] },
            { databasePorts: [5432], allowedDestinations: [], projectId: projectB.id },
          ]) {
            assert.equal((await request(app).put(policyPath).set("Cookie", cookie(owner.id)).send({ databasePolicy })).status, 400);
          }
          assert.equal((await request(app).get("/api/v1/projects/not-a-uuid/alerts").set("Cookie", cookie(owner.id))).status, 400);
          assert.equal((await request(app).get(policyPath)).status, 401);
          assert.equal((await request(app).put(policyPath).send({ databasePolicy: null })).status, 401);
          assert.equal((await request(app).get(policyPath).set("Cookie", cookie(outsider.id))).status, 404);
          await transaction.delete(workspaceMembers).where(and(
            eq(workspaceMembers.userId, member.id), eq(workspaceMembers.workspaceId, workspaceA.id),
          ));
          assert.equal((await request(app).get(alertsPath).set("Cookie", cookie(member.id))).status, 404);
        });
        await t.test("post-commit detection failures are explicit; persisted events can be safely reprocessed", async () => {
          await transaction.execute(sql.raw(`
            CREATE FUNCTION reject_test_alert() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test detection persistence failure'; END $$;
            CREATE TRIGGER reject_test_alert BEFORE INSERT ON security_alerts
            FOR EACH ROW EXECUTE FUNCTION reject_test_alert();
          `));
          const input = event("192.0.2.30", 100, "NETWORK_CONNECTION_ATTEMPT");
          const response = await ingest(input);
          assert.equal(response.status, 500);
          assert.equal(response.body.message, "Internal server error");
          const [persisted] = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, input.eventId));
          assert.ok(persisted, "Detection ran before event persistence completed");
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.30")).length, 0);
          await transaction.execute(sql.raw("DROP TRIGGER reject_test_alert ON security_alerts; DROP FUNCTION reject_test_alert();"));
          const duplicate = await ingest(input);
          assert.deepEqual(duplicate.body.data, { insertedCount: 0, duplicateCount: 1 });
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.30")).length, 0);
          await detectEventsService(projectA.id, [persisted.id]);
          await detectEventsService(projectA.id, [persisted.id]);
          assert.equal((await ruleAlerts(DATABASE_CONNECTION_RULE_ID, "192.0.2.30")).length, 1);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Detection test schema survived rollback");
  } finally {
    client.release(true);
    await pool.end();
  }
});
