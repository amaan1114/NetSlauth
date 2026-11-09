import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, workspaces, projects, agents, networkEvents } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { networkEventSchema, networkEventTypeSchema } from "@workspace/netsleuth-shared";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";
import { ingestEventsService } from "../src/modules/events/event.service.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_EVENT_TESTS");

test("event ingestion with real agent authentication and isolated PostgreSQL persistence", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `event_test_${randomUUID().replaceAll("-", "")}`;
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
        const [aWorkspace, bWorkspace] = await transaction.insert(workspaces).values([{ name: "A" }, { name: "B" }]).returning();
        assert.ok(aWorkspace && bWorkspace);
        const [aProject, bProject] = await transaction.insert(projects).values([
          { name: "A", workspaceId: aWorkspace.id }, { name: "B", workspaceId: bWorkspace.id },
        ]).returning();
        assert.ok(aProject && bProject);
        const aKey = `ns_agent_${randomBytes(32).toString("hex")}`;
        const bKey = `ns_agent_${randomBytes(32).toString("hex")}`;
        const [aAgent, bAgent] = await transaction.insert(agents).values([
          { name: "A", projectId: aProject.id, apiKeyHash: createHash("sha256").update(aKey).digest("hex") },
          { name: "B", projectId: bProject.id, apiKeyHash: createHash("sha256").update(bKey).digest("hex") },
        ]).returning();
        assert.ok(aAgent && bAgent);
        const app = createApp(async () => {});
        const endpoint = "/api/v1/ingest/events";
        const event = () => ({
          eventId: randomUUID(),
          eventType: "NETWORK_CONNECTION_ATTEMPT",
          sourceIp: "192.0.2.10",
          sourcePort: 45123,
          destinationIp: "2001:db8::10",
          destinationPort: 443,
          protocol: "TCP",
          metadata: { service: "https", tags: ["test"], nested: { count: 1, ok: true, empty: null } },
          occurredAt: "2026-11-09T12:30:00+05:30",
        });
        const send = (body: unknown, key = aKey) => request(app).post(endpoint).set("X-Agent-Key", key).send(body);
        const rows = () => transaction.select().from(networkEvents);
        const readAgent = async () => {
          const [agent] = await transaction.select().from(agents).where(eq(agents.id, aAgent.id));
          assert.ok(agent);
          return agent;
        };
        let firstEventId = "";

        await t.test("single event is persisted with all fields and authenticated ownership", async () => {
          const input = event();
          firstEventId = input.eventId;
          const response = await send(input);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body, {
            success: true, statusCode: 200, message: "Events ingested successfully",
            data: { insertedCount: 1, duplicateCount: 0 },
          });
          const [stored] = await rows();
          assert.ok(stored);
          assert.equal(stored.agentId, aAgent.id);
          assert.equal(stored.eventId, input.eventId);
          assert.equal(stored.eventType, input.eventType);
          assert.equal(stored.sourceIp, input.sourceIp);
          assert.equal(stored.sourcePort, input.sourcePort);
          assert.equal(stored.destinationIp, input.destinationIp);
          assert.equal(stored.destinationPort, input.destinationPort);
          assert.equal(stored.protocol, input.protocol);
          assert.deepEqual(stored.metadata, input.metadata);
          assert.equal(stored.occurredAt.toISOString(), "2026-11-09T07:00:00.000Z");
          assert.ok(stored.receivedAt instanceof Date);
          assert.equal((await readAgent()).status, "INACTIVE", "Non-heartbeat must not change liveness");
        });

        await t.test("batch accepts each non-heartbeat type, IPv4/IPv6 and optional fields", async () => {
          const input = networkEventTypeSchema.options.filter((type) => type !== "AGENT_HEARTBEAT")
            .map((eventType, index) => ({
              eventId: randomUUID(), eventType, sourceIp: "2001:db8::20",
              destinationIp: "198.51.100.2", protocol: index % 2 ? "UDP" : "OTHER",
              occurredAt: "2026-11-09T07:00:00Z",
            }));
          const response = await send(input);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data, { insertedCount: 5, duplicateCount: 0 });
          for (const sent of input) {
            const [stored] = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, sent.eventId));
            assert.ok(stored);
            assert.equal(stored.eventType, sent.eventType);
            assert.equal(stored.sourcePort, null);
            assert.equal(stored.destinationPort, null);
            assert.deepEqual(stored.metadata, {});
          }
        });

        await t.test("retries, within-batch duplicates and UUID casing are idempotent", async () => {
          const replay = await send({ ...event(), eventId: firstEventId.toUpperCase() });
          assert.equal(replay.status, 200);
          assert.deepEqual(replay.body.data, { insertedCount: 0, duplicateCount: 1 });
          const fresh = event();
          const response = await send([{ ...event(), eventId: firstEventId }, fresh, fresh]);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data, { insertedCount: 1, duplicateCount: 2 });
          const retried = await send([fresh, fresh]);
          assert.deepEqual(retried.body.data, { insertedCount: 0, duplicateCount: 2 });
          const sameIdOtherAgent = await send({ ...fresh }, bKey);
          assert.deepEqual(sameIdOtherAgent.body.data, { insertedCount: 1, duplicateCount: 0 });
          const stored = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, fresh.eventId));
          assert.deepEqual(stored.map((row) => row.agentId).sort(), [aAgent.id, bAgent.id].sort());
        });

        await t.test("invalid event types and malformed fields reject the entire batch", async () => {
          const before = (await rows()).length;
          const invalid = [
            { eventType: "UNKNOWN" }, { eventId: "not-a-uuid" }, { protocol: "ICMP" },
            { sourceIp: "999.1.1.1" }, { destinationIp: "invalid" }, { sourceIp: "192.0.2.1/24" },
            { sourcePort: -1 }, { sourcePort: 65536 }, { destinationPort: 1.5 }, { destinationPort: "443" },
            { metadata: [] }, { metadata: null }, { metadata: "raw packet" },
            { occurredAt: "yesterday" }, { occurredAt: "2026-11-09T07:00:00" },
            { occurredAt: "2026-02-30T07:00:00Z" }, { rawPayload: "packet bytes" },
          ];
          for (const patch of invalid) {
            const response = await send([event(), { ...event(), ...patch }]);
            assert.equal(response.status, 400);
            assert.equal(response.body.success, false);
          }
          const missing = event();
          const { sourceIp: omittedSourceIp, ...withoutSourceIp } = missing;
          assert.ok(omittedSourceIp);
          assert.equal((await send(withoutSourceIp)).status, 400);
          assert.equal((await rows()).length, before, "Partial valid events were written");
          assert.equal(networkEventSchema.safeParse({ ...event(), metadata: { invalid: Infinity } }).success, false);
        });

        await t.test("batch size is 1–100 and both port boundaries are accepted", async () => {
          const before = (await rows()).length;
          assert.equal((await send([])).status, 400);
          assert.equal((await send(Array.from({ length: 101 }, event))).status, 400);
          assert.equal((await send({ events: [event()] })).status, 400, "Use an object or a raw event array");
          assert.equal((await rows()).length, before);
          const batch = Array.from({ length: 100 }, () => ({ ...event(), sourcePort: 0, destinationPort: 65535 }));
          const response = await send(batch);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data, { insertedCount: 100, duplicateCount: 0 });
          assert.equal((await rows()).length, before + 100);
        });

        await t.test("missing, invalid or user credentials do not authenticate an agent", async () => {
          const before = (await rows()).length;
          assert.equal((await request(app).post(endpoint).send(event())).status, 401);
          for (const key of ["bad", `ns_agent_${randomBytes(32).toString("hex")}`, signToken(randomUUID(), "access", 900)]) {
            assert.equal((await send(event(), key)).status, 401);
          }
          assert.equal((await request(app).post(endpoint).set("Authorization", `Bearer ${aKey}`).send(event())).status, 401);
          assert.equal((await request(app).post(endpoint).set("Cookie", `netsleuth_access=${signToken(randomUUID(), "access", 900)}`).send(event())).status, 401);
          assert.equal((await rows()).length, before);
        });

        await t.test("body agent/project IDs are rejected and scope always comes from the key", async () => {
          const before = (await rows()).length;
          for (const patch of [{ agentId: bAgent.id }, { projectId: bProject.id }, { agentId: bAgent.id, projectId: bProject.id }]) {
            assert.equal((await send({ ...event(), ...patch })).status, 400);
          }
          const input = { ...event(), metadata: { agentId: bAgent.id, projectId: bProject.id } };
          const response = await send(input);
          assert.equal(response.status, 200);
          const [stored] = await transaction.select().from(networkEvents).where(eq(networkEvents.eventId, input.eventId));
          assert.ok(stored);
          assert.equal(stored.agentId, aAgent.id, "Metadata must never establish identity");
          assert.equal((await rows()).length, before + 1);
        });

        await t.test("heartbeat updates only its authenticated agent with server time, not supplied time", async () => {
          const input = { ...event(), eventType: "AGENT_HEARTBEAT", occurredAt: "2000-01-01T00:00:00Z" };
          const start = Date.now();
          const response = await send(input);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data, { insertedCount: 1, duplicateCount: 0 });
          const agent = await readAgent();
          assert.equal(agent.status, "ONLINE");
          assert.ok(agent.lastHeartbeatAt);
          assert.ok(agent.lastHeartbeatAt.getTime() >= start && agent.lastHeartbeatAt.getTime() <= Date.now());
          const [other] = await transaction.select().from(agents).where(eq(agents.id, bAgent.id));
          assert.ok(other);
          assert.equal(other.status, "INACTIVE");
          assert.equal(other.lastHeartbeatAt, null);
          await transaction.update(agents).set({ status: "OFFLINE" }).where(eq(agents.id, aAgent.id));
          const replay = await send(input);
          assert.deepEqual(replay.body.data, { insertedCount: 0, duplicateCount: 1 });
          const unchanged = await readAgent();
          assert.equal(unchanged.status, "OFFLINE");
          assert.equal(unchanged.lastHeartbeatAt?.getTime(), agent.lastHeartbeatAt.getTime());
        });

        await t.test("a failing heartbeat update rolls back every inserted event and returns no success", async () => {
          // A test-only database trigger forces an actual PostgreSQL failure after event insertion.
          await transaction.execute(sql.raw(`
            CREATE FUNCTION reject_test_heartbeat() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test heartbeat persistence failure'; END $$;
            CREATE TRIGGER reject_test_heartbeat BEFORE UPDATE OF last_heartbeat_at ON agents
            FOR EACH ROW EXECUTE FUNCTION reject_test_heartbeat();
          `));
          const before = (await rows()).length;
          const previous = await readAgent();
          const response = await send([event(), { ...event(), eventType: "AGENT_HEARTBEAT" }]);
          assert.equal(response.status, 500);
          assert.deepEqual(response.body, { success: false, statusCode: 500, message: "Internal server error" });
          assert.equal((await rows()).length, before);
          const unchanged = await readAgent();
          assert.equal(unchanged.status, previous.status);
          assert.equal(unchanged.lastHeartbeatAt?.getTime(), previous.lastHeartbeatAt?.getTime());
          await transaction.execute(sql.raw("DROP TRIGGER reject_test_heartbeat ON agents; DROP FUNCTION reject_test_heartbeat();"));
        });

        await t.test("JSON parsing and request size failures never persist events", async () => {
          const before = (await rows()).length;
          assert.equal((await request(app).post(endpoint).set("X-Agent-Key", aKey)
            .set("Content-Type", "application/json").send('{"eventId":')).status, 400);
          assert.equal((await send({ ...event(), metadata: { note: "x".repeat(1024 * 1024) } })).status, 413);
          assert.equal((await rows()).length, before);
        });

        await t.test("revocation and mismatched trusted scope fail closed before writing", async () => {
          const before = (await rows()).length;
          await assert.rejects(
            ingestEventsService(aAgent.id, bProject.id, [networkEventSchema.parse(event())]),
            { statusCode: 401 },
          );
          await transaction.update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, aAgent.id));
          assert.equal((await send(event())).status, 401);
          // Simulate a key revoked after middleware already resolved its IDs.
          await assert.rejects(
            ingestEventsService(aAgent.id, aProject.id, [networkEventSchema.parse(event())]),
            { statusCode: 401 },
          );
          assert.equal((await rows()).length, before);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Event test schema survived rollback");
  } finally {
    client.release(true);
    await pool.end();
  }
});
