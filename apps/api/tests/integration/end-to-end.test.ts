import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, agents, users, networkEvents, securityAlerts } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { networkEventSchema, type NetworkEventInput } from "@workspace/netsleuth-shared";
// Test-only composition: the production API and agent remain independent.
import { startAgent } from "../../../agent/src/index.js";
import { readConfig } from "../../../agent/src/config/index.js";
import { publishEvents } from "../../../agent/src/services/eventPublisher.js";

process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";
delete process.env.COOKIE_DOMAIN;
const { createApp } = await import("../../src/app.js");
const { db, pool: applicationPool } = await import("../../src/services/database.js");
after(() => applicationPool.end());

test("HTTP cookies → workspace/project → real Linux agent → PostgreSQL → alerts → revocation", { timeout: 45000 }, async (t) => {
  assert.equal(process.platform, "linux", "This explicit host-collection integration test requires Linux and iproute2/ss.");
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `e2e_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("ROLLBACK_E2E_FIXTURES");
  const logs: string[] = [];
  t.mock.method(console, "log", (...parts: unknown[]) => logs.push(parts.join(" ")));
  t.mock.method(console, "error", (...parts: unknown[]) => logs.push(parts.join(" ")));
  try {
    await assert.rejects(drizzle(client, { schema }).transaction(async (transaction) => {
      // Fresh migrations + all HTTP writes stay in one rollback-only schema.
      await transaction.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
      await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", pg_catalog`));
      const directory = new URL("../../../../packages/database/drizzle/", import.meta.url);
      for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
        const migration = await readFile(new URL(name, directory), "utf8");
        await transaction.execute(sql.raw(migration.replaceAll('"public".', `"${schemaName}".`)));
      }
      for (const method of ["select", "insert", "update", "delete", "transaction"] as const) {
        t.mock.method(db, method, transaction[method].bind(transaction));
      }
      const server = createHttpServer(createApp(async () => {}));
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const apiUrl = `http://127.0.0.1:${address.port}`;
      const browser = request.agent(server);
      const outsider = request.agent(server);
      const password = "Integration-test-password-42!";
      const email = `${randomUUID()}@example.invalid`;
      let workspaceId = "";
      let projectId = "";
      let otherProjectId = "";
      let agentId = "";
      let apiKey = "";
      let storedHash = "";
      let config: ReturnType<typeof readConfig>;
      let collected: NetworkEventInput;
      const path = () => `/api/v1/projects/${projectId}`;
      const rowEvents = () => transaction.select().from(networkEvents).where(eq(networkEvents.agentId, agentId));
      const rowAlerts = () => transaction.select().from(securityAlerts).where(eq(securityAlerts.projectId, projectId));
      try {
        await t.test("registration, logout, login and setup use real cookies; registration stores only key/password hashes", async () => {
          const registered = await browser.post("/api/v1/auth/register").send({ name: "Integration owner", email, password }).expect(201);
          assert.ok(registered.headers["set-cookie"].every((cookie: string) => cookie.includes("HttpOnly")));
          assert.equal(registered.body.data.accessToken, undefined);
          assert.equal(registered.body.data.user.passwordHash, undefined);
          const [user] = await transaction.select().from(users).where(eq(users.email, email));
          assert.ok(user && user.passwordHash !== password && user.passwordHash.startsWith("$2"));
          await browser.post("/api/v1/auth/logout").expect(200);
          await browser.get("/api/v1/auth/me").expect(401);
          await browser.post("/api/v1/auth/login").send({ email, password }).expect(200);
          await browser.get("/api/v1/auth/me").expect(200);
          const workspace = await browser.post("/api/v1/workspaces").send({ name: "Integration workspace" }).expect(201);
          workspaceId = workspace.body.data.workspace.id;
          const project = await browser.post(`/api/v1/workspaces/${workspaceId}/projects`).send({ name: "Integration project" }).expect(201);
          projectId = project.body.data.project.id;
          const registration = await browser.post(`${path()}/agents`).send({ name: "Integration Linux agent" }).expect(201);
          apiKey = registration.body.data.apiKey;
          agentId = registration.body.data.agent.id;
          const [stored] = await transaction.select().from(agents).where(eq(agents.id, agentId));
          storedHash = createHash("sha256").update(apiKey).digest("hex");
          assert.equal(stored?.apiKeyHash, storedHash);
          assert.equal(stored?.projectId, projectId);
          assert.equal(registration.body.data.agent.apiKeyHash, undefined);
          config = readConfig({ NETSLEUTH_API_URL: apiUrl, NETSLEUTH_AGENT_KEY: apiKey });
        });

        await t.test("the running agent collects a controlled TCP socket, publishes over HTTP, updates heartbeat and creates an alert", async () => {
          // This is a real local TCP socket, NOT a real database/login attempt.
          const sockets = new Set<Socket>();
          const listener = createTcpServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
          listener.listen(0, "127.0.0.1");
          await once(listener, "listening");
          const target = listener.address();
          assert.ok(target && typeof target !== "string");
          const connection = createConnection({ host: "127.0.0.1", port: target.port });
          await once(connection, "connect");
          await browser.put(`${path()}/database-policy`).send({
            databasePolicy: { databasePorts: [target.port], allowedDestinations: [] },
          }).expect(200);
          const running = startAgent(config);
          try {
            const deadline = Date.now() + 6000;
            while (Date.now() < deadline) {
              const observed = (await rowEvents()).find((event) =>
                event.eventType === "NETWORK_CONNECTION_ESTABLISHED" &&
                event.sourceIp === "127.0.0.1" && event.destinationPort === target.port);
              const [agent] = await transaction.select().from(agents).where(eq(agents.id, agentId));
              const alert = (await rowAlerts()).find((item) => item.evidence.destinationPort === target.port);
              if (observed && alert && agent?.status === "ONLINE" && agent.lastHeartbeatAt) {
                collected = networkEventSchema.parse({
                  eventId: observed.eventId, eventType: observed.eventType, sourceIp: observed.sourceIp,
                  sourcePort: observed.sourcePort ?? undefined, destinationIp: observed.destinationIp,
                  destinationPort: observed.destinationPort ?? undefined, protocol: observed.protocol,
                  metadata: observed.metadata, occurredAt: observed.occurredAt.toISOString(),
                });
                assert.equal(observed.metadata.collector, "ss");
                assert.equal(alert.ruleId, "UNEXPECTED_DATABASE_CONNECTION");
                assert.equal(alert.agentId, agentId);
                break;
              }
              await delay(50);
            }
            assert.ok(collected!, "No controlled TCP observation/alert/heartbeat: check Linux ss availability and captured agent diagnostics.");
          } finally {
            await running.stop();
            connection.destroy();
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => listener.close(() => resolve()));
          }
        });

        await t.test("replaying the exact collected UUID is a duplicate and does not rerun detection or overwrite evidence", async () => {
          const before = await rowAlerts();
          assert.deepEqual(await publishEvents(config, [collected]), { insertedCount: 0, duplicateCount: 1 });
          assert.deepEqual(await rowAlerts(), before);
          assert.equal((await rowEvents()).filter((event) => event.eventId === collected.eventId).length, 1);
        });

        const failure = (sourceIp: string, second: number): NetworkEventInput => ({
          eventId: randomUUID(), eventType: "AUTHENTICATION_FAILURE", sourceIp,
          destinationIp: "198.51.100.20", destinationPort: 5432, protocol: "TCP",
          occurredAt: new Date(Date.UTC(2026, 10, 9, 10, 0, second)).toISOString(),
          metadata: { fixture: "synthetic_authentication_evidence_not_socket_inference" },
        });
        await t.test("synthetic authentication evidence triggers at five, not four, and never mixes source IPs", async () => {
          await publishEvents(config, [0, 10, 20, 30].map((second) => failure("192.0.2.200", second)));
          await publishEvents(config, [0, 10, 20, 30].map((second) => failure("192.0.2.201", second)));
          assert.equal((await rowAlerts()).filter((alert) => alert.ruleId === "REPEATED_AUTHENTICATION_FAILURES").length, 0);
          await publishEvents(config, [failure("192.0.2.200", 40)]);
          const [alert] = (await rowAlerts()).filter((item) => item.ruleId === "REPEATED_AUTHENTICATION_FAILURES");
          assert.ok(alert);
          assert.equal(alert.severity, "HIGH");
          assert.equal(alert.evidence.sourceIp, "192.0.2.200");
          assert.equal(alert.evidence.failureCount, 5);
          assert.equal((alert.evidence.eventIds as string[]).length, 5);
        });

        await t.test("allowed database destinations do not alert; unexpected attempts retain evidence without claiming login success", async () => {
          await browser.put(`${path()}/database-policy`).send({
            databasePolicy: { databasePorts: [5432], allowedDestinations: [{ ip: "198.51.100.20", port: 5432, protocol: "TCP" }] },
          }).expect(200);
          const allowed = { ...failure("192.0.2.202", 0), eventType: "NETWORK_CONNECTION_ATTEMPT" as const };
          const before = (await rowAlerts()).length;
          await publishEvents(config, [allowed]);
          assert.equal((await rowAlerts()).length, before);
          const unexpected = { ...allowed, eventId: randomUUID(), destinationIp: "198.51.100.21" };
          await publishEvents(config, [unexpected]);
          const first = (await rowAlerts()).find((alert) => alert.evidence.eventId === unexpected.eventId);
          assert.ok(first);
          assert.equal(first.evidence.observation, "connection_attempt");
          assert.match(first.description, /does not prove a successful database login/);
          await publishEvents(config, [{ ...unexpected, eventId: randomUUID(), occurredAt: failure("192.0.2.202", 10).occurredAt }]);
          const updated = (await rowAlerts()).find((alert) => alert.id === first.id);
          assert.ok(updated);
          assert.equal(updated.firstSeenAt.getTime(), first.firstSeenAt.getTime());
          assert.equal(updated.lastSeenAt.toISOString(), failure("192.0.2.202", 10).occurredAt);
          assert.equal((await rowAlerts()).length, before + 1);
        });

        await t.test("a different cookie user cannot read/revoke another workspace's project, agent or alerts", async () => {
          await outsider.post("/api/v1/auth/register").send({ name: "Integration outsider", email: `${randomUUID()}@example.invalid`, password }).expect(201);
          const workspace = await outsider.post("/api/v1/workspaces").send({ name: "Other workspace" }).expect(201);
          const project = await outsider.post(`/api/v1/workspaces/${workspace.body.data.workspace.id}/projects`).send({ name: "Other project" }).expect(201);
          otherProjectId = project.body.data.project.id;
          await outsider.get(`/api/v1/workspaces/${workspaceId}`).expect(404);
          await outsider.get(path()).expect(404);
          await outsider.get(`${path()}/alerts`).expect(404);
          await outsider.get(`/api/v1/agents/${agentId}`).expect(404);
          await outsider.post(`/api/v1/agents/${agentId}/revoke`).expect(404);
          const ownAlerts = await outsider.get(`/api/v1/projects/${otherProjectId}/alerts`).expect(200);
          assert.deepEqual(ownAlerts.body.data.alerts, []);
          const alerts = await browser.get(`${path()}/alerts?severity=HIGH&status=OPEN&page=1&limit=1`).expect(200);
          assert.equal(alerts.body.data.alerts.length, 1);
          assert.equal(alerts.body.data.alerts[0].projectId, projectId);
          const listed = await browser.get(`${path()}/agents`).expect(200);
          assert.equal(listed.body.data.agents[0].apiKey, undefined);
          assert.equal(listed.body.data.agents[0].apiKeyHash, undefined);
          await request(server).post("/api/v1/ingest/events").set("X-Agent-Key", apiKey)
            .send({ ...failure("192.0.2.203", 0), projectId: otherProjectId }).expect(400);
          await request(server).get(`${path()}/alerts`).set("X-Agent-Key", apiKey).expect(401);
        });

        await t.test("revocation immediately rejects the real publisher and logs contain no credentials", async () => {
          const before = (await rowEvents()).length;
          await browser.post(`/api/v1/agents/${agentId}/revoke`).expect(200);
          await assert.rejects(publishEvents(config, [failure("192.0.2.204", 0)]), /401/);
          assert.equal((await rowEvents()).length, before);
          const [agent] = await transaction.select().from(agents).where(eq(agents.id, agentId));
          assert.equal(agent?.status, "INACTIVE");
          for (const value of [password, apiKey, storedHash]) {
            assert.ok(value && !logs.join("\n").includes(value), "Credential appeared in captured logs");
          }
        });
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      }
      throw rollback;
    }), (error) => error === rollback);
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Integration schema must disappear after rollback");
  } finally {
    // No application rows or migration journal entries are ever committed.
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
