import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, users, workspaces, workspaceMembers, projects } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_WORKSPACE_TESTS");

test("workspace and project authorization with real PostgreSQL, isolated and rolled back", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `workspace_test_${randomUUID().replaceAll("-", "")}`;
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
        const people = await transaction.insert(users).values(
          ["Owner A", "Owner B", "Admin", "Member"].map((name) => ({
            name, email: `${randomUUID()}@example.invalid`, passwordHash: "unused-test-fixture",
          })),
        ).returning();
        const [ownerA, ownerB, admin, member] = people;
        assert.ok(ownerA && ownerB && admin && member);
        const cookie = (userId: string) => `netsleuth_access=${signToken(userId, "access", 900)}`;
        const aCookie = cookie(ownerA.id);
        const bCookie = cookie(ownerB.id);
        const adminCookie = cookie(admin.id);
        const memberCookie = cookie(member.id);
        const app = createApp(async () => {});
        const base = "/api/v1";
        let aWorkspace = "";
        let bWorkspace = "";
        let aProject = "";
        let bProject = "";

        await t.test("all six endpoints require a valid cookie, never a Bearer header", async () => {
          const id = randomUUID();
          const calls = [
            request(app).post(`${base}/workspaces`).send({ name: "Unauthenticated" }),
            request(app).get(`${base}/workspaces`),
            request(app).get(`${base}/workspaces/${id}`),
            request(app).post(`${base}/workspaces/${id}/projects`).send({ name: "No" }),
            request(app).get(`${base}/workspaces/${id}/projects`),
            request(app).get(`${base}/projects/${id}`),
          ];
          for (const call of calls) assert.equal((await call).status, 401);
          assert.equal((await request(app).get(`${base}/workspaces`)
            .set("Authorization", `Bearer ${signToken(ownerA.id, "access", 900)}`)).status, 401);
        });

        await t.test("workspace creation trims its name and adds exactly one OWNER", async () => {
          const response = await request(app).post(`${base}/workspaces`)
            .set("Cookie", aCookie).send({ name: "  Workspace A  " });
          assert.equal(response.status, 201);
          assert.equal(response.body.data.workspace.name, "Workspace A");
          aWorkspace = response.body.data.workspace.id;
          const memberships = await transaction.select().from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, aWorkspace));
          assert.equal(memberships.length, 1);
          assert.equal(memberships[0]!.userId, ownerA.id);
          assert.equal(memberships[0]!.role, "OWNER");
          const other = await request(app).post(`${base}/workspaces`)
            .set("Cookie", bCookie).send({ name: "Workspace B" });
          assert.equal(other.status, 201);
          bWorkspace = other.body.data.workspace.id;
        });

        await t.test("workspace lists/details are scoped to the authenticated member", async () => {
          const response = await request(app).get(`${base}/workspaces`).set("Cookie", aCookie);
          assert.deepEqual(response.body.data.workspaces.map((workspace: { id: string }) => workspace.id), [aWorkspace]);
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}`).set("Cookie", aCookie)).status, 200);
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}`).set("Cookie", bCookie)).status, 404);
          assert.equal((await request(app).get(`${base}/workspaces/${randomUUID()}`).set("Cookie", aCookie)).status, 404);
          const empty = await request(app).get(`${base}/workspaces`).set("Cookie", memberCookie);
          assert.deepEqual(empty.body.data.workspaces, []);
        });

        await t.test("owners create projects and only see projects from the selected workspace", async () => {
          const empty = await request(app).get(`${base}/workspaces/${aWorkspace}/projects`).set("Cookie", aCookie);
          assert.equal(empty.status, 200);
          assert.deepEqual(empty.body.data.projects, []);
          const first = await request(app).post(`${base}/workspaces/${aWorkspace}/projects`)
            .set("Cookie", aCookie).send({ name: " Project A ", description: " Description " });
          assert.equal(first.status, 201);
          assert.equal(first.body.data.project.workspaceId, aWorkspace);
          assert.equal(first.body.data.project.name, "Project A");
          assert.equal(first.body.data.project.description, "Description");
          aProject = first.body.data.project.id;
          const other = await request(app).post(`${base}/workspaces/${bWorkspace}/projects`)
            .set("Cookie", bCookie).send({ name: "Project B" });
          assert.equal(other.status, 201);
          assert.equal(other.body.data.project.description, null);
          bProject = other.body.data.project.id;
          const listed = await request(app).get(`${base}/workspaces/${aWorkspace}/projects`).set("Cookie", aCookie);
          assert.deepEqual(listed.body.data.projects.map((project: { id: string }) => project.id), [aProject]);
          assert.equal((await request(app).get(`${base}/projects/${aProject}`).set("Cookie", aCookie)).status, 200);
        });

        await t.test("changing UUIDs never exposes or creates another workspace's resources", async () => {
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}/projects`).set("Cookie", bCookie)).status, 404);
          assert.equal((await request(app).post(`${base}/workspaces/${aWorkspace}/projects`)
            .set("Cookie", bCookie).send({ name: "Unauthorized" })).status, 404);
          assert.equal((await request(app).get(`${base}/projects/${aProject}`).set("Cookie", bCookie)).status, 404);
          assert.equal((await request(app).get(`${base}/projects/${bProject}`).set("Cookie", aCookie)).status, 404);
          assert.equal((await request(app).get(`${base}/projects/${randomUUID()}`).set("Cookie", aCookie)).status, 404);
        });

        await t.test("MEMBER can read but only OWNER and ADMIN can create projects", async () => {
          await transaction.insert(workspaceMembers).values([
            { userId: admin.id, workspaceId: aWorkspace, role: "ADMIN" },
            { userId: member.id, workspaceId: aWorkspace, role: "MEMBER" },
          ]);
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}`).set("Cookie", memberCookie)).status, 200);
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}/projects`).set("Cookie", memberCookie)).status, 200);
          assert.equal((await request(app).get(`${base}/projects/${aProject}`).set("Cookie", memberCookie)).status, 200);
          assert.equal((await request(app).post(`${base}/workspaces/${aWorkspace}/projects`)
            .set("Cookie", memberCookie).send({ name: "Forbidden" })).status, 403);
          assert.equal((await request(app).post(`${base}/workspaces/${aWorkspace}/projects`)
            .set("Cookie", adminCookie).send({ name: "Admin project" })).status, 201);
        });

        await t.test("role changes and removed memberships take effect with the same JWT", async () => {
          await transaction.update(workspaceMembers).set({ role: "MEMBER" })
            .where(and(eq(workspaceMembers.userId, admin.id), eq(workspaceMembers.workspaceId, aWorkspace)));
          assert.equal((await request(app).post(`${base}/workspaces/${aWorkspace}/projects`)
            .set("Cookie", adminCookie).send({ name: "No longer admin" })).status, 403);
          await transaction.delete(workspaceMembers)
            .where(and(eq(workspaceMembers.userId, member.id), eq(workspaceMembers.workspaceId, aWorkspace)));
          assert.equal((await request(app).get(`${base}/workspaces/${aWorkspace}`).set("Cookie", memberCookie)).status, 404);
          assert.equal((await request(app).get(`${base}/projects/${aProject}`).set("Cookie", memberCookie)).status, 404);
        });

        await t.test("Zod rejects invalid IDs, empty names, oversized descriptions, and scope injection", async () => {
          assert.equal((await request(app).get(`${base}/workspaces/not-a-uuid`).set("Cookie", aCookie)).status, 400);
          assert.equal((await request(app).get(`${base}/projects/not-a-uuid`).set("Cookie", aCookie)).status, 400);
          assert.equal((await request(app).get(`${base}/workspaces/not-a-uuid/projects`).set("Cookie", aCookie)).status, 400);
          assert.equal((await request(app).post(`${base}/workspaces`).set("Cookie", aCookie).send({ name: " " })).status, 400);
          for (const body of [{ name: "" }, { name: "Too big", description: "a".repeat(2001) }, { name: "Injected", workspaceId: bWorkspace }, { name: "Injected", role: "OWNER" }]) {
            assert.equal((await request(app).post(`${base}/workspaces/${aWorkspace}/projects`).set("Cookie", aCookie).send(body)).status, 400);
          }
        });

        await t.test("failed OWNER insertion rolls back the workspace and hides database errors", async () => {
          const before = await transaction.select().from(workspaces);
          const response = await request(app).post(`${base}/workspaces`)
            .set("Cookie", cookie(randomUUID())).send({ name: "Must roll back" });
          assert.equal(response.status, 500);
          assert.deepEqual(response.body, { success: false, statusCode: 500, message: "Internal server error" });
          assert.equal((await transaction.select().from(workspaces)).length, before.length);
          const stored = await transaction.select().from(projects).where(eq(projects.name, "Unauthorized"));
          assert.equal(stored.length, 0);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Workspace test schema survived rollback");
  } finally {
    client.release(true);
    await pool.end();
  }
});
