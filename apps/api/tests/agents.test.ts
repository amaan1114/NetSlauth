import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, users, workspaces, workspaceMembers, projects, agents } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";
import { agentAuthMiddleware } from "../src/modules/agents/agent.middleware.js";
import { globalErrorHandler } from "../src/middleware/globalErrorHandler.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_AGENT_TESTS");

test("agent credentials and project authorization with isolated real PostgreSQL", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `agent_test_${randomUUID().replaceAll("-", "")}`;
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.join(" ")));
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
            name, email: `${randomUUID()}@example.invalid`, passwordHash: "unused-test-fixture",
          })),
        ).returning();
        assert.ok(owner && outsider && member);
        const [aWorkspace, bWorkspace] = await transaction.insert(workspaces)
          .values([{ name: "A" }, { name: "B" }]).returning();
        assert.ok(aWorkspace && bWorkspace);
        await transaction.insert(workspaceMembers).values([
          { userId: owner.id, workspaceId: aWorkspace.id, role: "OWNER" },
          { userId: outsider.id, workspaceId: bWorkspace.id, role: "OWNER" },
          { userId: member.id, workspaceId: aWorkspace.id, role: "MEMBER" },
        ]);
        const [aProject, bProject] = await transaction.insert(projects).values([
          { name: "A", workspaceId: aWorkspace.id },
          { name: "B", workspaceId: bWorkspace.id },
        ]).returning();
        assert.ok(aProject && bProject);
        const [legacy] = await transaction.insert(agents).values({ projectId: aProject.id, name: "Legacy" }).returning();
        assert.ok(legacy);
        const cookie = (id: string) => `netsleuth_access=${signToken(id, "access", 900)}`;
        const ownerCookie = cookie(owner.id);
        const outsiderCookie = cookie(outsider.id);
        const app = createApp(async () => {});
        // Test-only route proves the real middleware. No ingestion/probe endpoint is added to production.
        const probe = express();
        probe.use(express.json());
        probe.post("/probe", agentAuthMiddleware, (req, res) => {
          res.json({ agentId: req.agentId, projectId: req.projectId, userId: req.userId ?? null });
        });
        probe.use(globalErrorHandler);
        const base = "/api/v1";
        const path = `${base}/projects/${aProject.id}/agents`;
        let agentId = "";
        let apiKey = "";
        let secondKey = "";

        await t.test("management requires user cookies, never agent keys or Bearer JWTs", async () => {
          const calls = [
            request(app).post(path).send({ name: "No cookie" }),
            request(app).get(path),
            request(app).get(`${base}/agents/${legacy.id}`),
            request(app).post(`${base}/agents/${legacy.id}/revoke`),
          ];
          for (const call of calls) assert.equal((await call).status, 401);
          assert.equal((await request(app).post(path)
            .set("Authorization", `Bearer ${signToken(owner.id, "access", 900)}`).send({ name: "No" })).status, 401);
        });

        await t.test("registration returns a key once, stores only its hash, and binds the project", async () => {
          const response = await request(app).post(path).set("Cookie", ownerCookie).send({ name: " Sensor A " });
          assert.equal(response.status, 201);
          assert.equal(response.headers["cache-control"], "no-store");
          const { agent, apiKey: key } = response.body.data;
          agentId = agent.id;
          apiKey = key;
          assert.match(apiKey, /^ns_agent_[a-f0-9]{64}$/);
          assert.equal(agent.name, "Sensor A");
          assert.equal(agent.projectId, aProject.id);
          assert.equal(agent.status, "INACTIVE");
          assert.equal(agent.revokedAt, null);
          assert.equal(agent.apiKeyHash, undefined);
          const [stored] = await transaction.select().from(agents).where(eq(agents.id, agentId));
          assert.ok(stored);
          assert.equal(stored.apiKeyHash, createHash("sha256").update(apiKey).digest("hex"));
          assert.equal(JSON.stringify(stored).includes(apiKey), false);
          const second = await request(app).post(path).set("Cookie", cookie(member.id)).send({ name: "Member sensor" });
          assert.equal(second.status, 201, "Any authorized project member can register an agent");
          secondKey = second.body.data.apiKey;
          assert.notEqual(apiKey, secondKey);
        });

        await t.test("cross-workspace and nonexistent project registration fail without inserting", async () => {
          const before = (await transaction.select().from(agents)).length;
          assert.equal((await request(app).post(path).set("Cookie", outsiderCookie).send({ name: "No" })).status, 404);
          assert.equal((await request(app).post(`${base}/projects/${bProject.id}/agents`)
            .set("Cookie", ownerCookie).send({ name: "No" })).status, 404);
          assert.equal((await request(app).post(`${base}/projects/${randomUUID()}/agents`)
            .set("Cookie", ownerCookie).send({ name: "No" })).status, 404);
          assert.equal((await transaction.select().from(agents)).length, before);
        });

        await t.test("valid agent key sets identity from the DB, ignoring supplied scope", async () => {
          const response = await request(probe).post("/probe").set("X-Agent-Key", apiKey)
            .send({ agentId: randomUUID(), projectId: bProject.id });
          assert.equal(response.status, 200);
          assert.deepEqual(response.body, { agentId, projectId: aProject.id, userId: null });
          assert.equal((await request(app).get(path).set("X-Agent-Key", apiKey)).status, 401);
        });

        await t.test("missing, malformed, unknown, JWT and cookie credentials fail agent auth", async () => {
          for (const key of ["", "invalid", `ns_agent_${randomBytes(32).toString("hex")}`, signToken(owner.id, "access", 900), `${apiKey},${secondKey}`]) {
            const response = await request(probe).post("/probe").set("X-Agent-Key", key);
            assert.equal(response.status, 401);
            assert.equal(response.body.message, "Invalid agent credential");
          }
          assert.equal((await request(probe).post("/probe")).status, 401);
          assert.equal((await request(probe).post("/probe").set("Cookie", ownerCookie)).status, 401);
          assert.equal((await request(probe).post("/probe").set("Cookie", `X-Agent-Key=${apiKey}`)).status, 401);
          assert.equal((await request(probe).post("/probe").set("Authorization", `Bearer ${apiKey}`)).status, 401);
        });

        await t.test("list and detail enforce membership and never expose keys or hashes", async () => {
          const listed = await request(app).get(path).set("Cookie", ownerCookie);
          assert.equal(listed.status, 200);
          assert.equal(listed.body.data.agents.length, 3);
          const detail = await request(app).get(`${base}/agents/${agentId}`).set("Cookie", cookie(member.id));
          assert.equal(detail.status, 200);
          assert.equal(detail.body.data.agent.id, agentId);
          for (const body of [listed.body, detail.body]) {
            assert.equal(JSON.stringify(body).includes(apiKey), false);
            assert.equal(JSON.stringify(body).includes("apiKeyHash"), false);
            assert.equal(JSON.stringify(body).includes('"apiKey"'), false);
          }
          assert.equal((await request(app).get(path).set("Cookie", outsiderCookie)).status, 404);
          assert.equal((await request(app).get(`${base}/agents/${agentId}`).set("Cookie", outsiderCookie)).status, 404);
          const empty = await request(app).get(`${base}/projects/${bProject.id}/agents`).set("Cookie", outsiderCookie);
          assert.deepEqual(empty.body.data.agents, []);
          assert.equal((await request(app).get(`${base}/agents/${randomUUID()}`).set("Cookie", ownerCookie)).status, 404);
        });

        await t.test("unauthorized revoke leaves key active; authorized revoke immediately rejects it", async () => {
          assert.equal((await request(app).post(`${base}/agents/${agentId}/revoke`).set("Cookie", outsiderCookie)).status, 404);
          assert.equal((await request(probe).post("/probe").set("X-Agent-Key", apiKey)).status, 200);
          const response = await request(app).post(`${base}/agents/${agentId}/revoke`).set("Cookie", cookie(member.id));
          assert.equal(response.status, 200);
          assert.ok(response.body.data.agent.revokedAt);
          assert.equal(response.body.data.agent.status, "INACTIVE");
          assert.equal(response.body.data.agent.apiKeyHash, undefined);
          assert.equal((await request(probe).post("/probe").set("X-Agent-Key", apiKey)).status, 401);
          assert.equal((await request(probe).post("/probe").set("X-Agent-Key", secondKey)).status, 200);
          const repeated = await request(app).post(`${base}/agents/${agentId}/revoke`).set("Cookie", ownerCookie);
          assert.equal(repeated.status, 200);
          assert.equal(repeated.body.data.agent.revokedAt, response.body.data.agent.revokedAt);
          const detail = await request(app).get(`${base}/agents/${agentId}`).set("Cookie", ownerCookie);
          assert.equal(detail.body.data.agent.revokedAt, response.body.data.agent.revokedAt);
        });

        await t.test("UUID/name validation and strict bodies prevent scope and credential injection", async () => {
          for (const body of [{ name: " " }, { name: "a".repeat(101) }, {}, { name: "No", projectId: bProject.id }, { name: "No", apiKeyHash: "x" }, { name: "No", status: "ONLINE" }]) {
            assert.equal((await request(app).post(path).set("Cookie", ownerCookie).send(body)).status, 400);
          }
          assert.equal((await request(app).get(`${base}/projects/not-a-uuid/agents`).set("Cookie", ownerCookie)).status, 400);
          assert.equal((await request(app).post(`${base}/projects/not-a-uuid/agents`).set("Cookie", ownerCookie).send({ name: "No" })).status, 400);
          assert.equal((await request(app).get(`${base}/agents/not-a-uuid`).set("Cookie", ownerCookie)).status, 400);
          assert.equal((await request(app).post(`${base}/agents/not-a-uuid/revoke`).set("Cookie", ownerCookie)).status, 400);
          assert.equal((await request(app).post(`${base}/agents/${randomUUID()}/revoke`).set("Cookie", ownerCookie)).status, 404);
        });

        await t.test("removed membership loses management access and deleting an agent invalidates its key", async () => {
          await transaction.delete(workspaceMembers).where(eq(workspaceMembers.userId, member.id));
          assert.equal((await request(app).get(path).set("Cookie", cookie(member.id))).status, 404);
          assert.equal((await request(app).post(path).set("Cookie", cookie(member.id)).send({ name: "No" })).status, 404);
          assert.equal((await request(app).get(`${base}/agents/${agentId}`).set("Cookie", cookie(member.id))).status, 404);
          assert.equal((await request(app).post(`${base}/agents/${agentId}/revoke`).set("Cookie", cookie(member.id))).status, 404);
          const remaining = await transaction.select().from(agents).where(eq(agents.name, "Member sensor"));
          assert.ok(remaining[0]);
          await transaction.delete(agents).where(eq(agents.id, remaining[0].id));
          assert.equal((await request(probe).post("/probe").set("X-Agent-Key", secondKey)).status, 401);
          assert.equal(logs.join("\n").includes(apiKey), false, "Request logger leaked agent key");
          assert.equal(logs.join("\n").includes(secondKey), false, "Request logger leaked agent key");
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Agent test schema survived rollback");
  } finally {
    client.release(true);
    await pool.end();
  }
});
