import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import bcrypt from "bcrypt";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, users, refreshSessions } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { db, pool as applicationPool } from "../src/services/database.js";
import { signToken } from "../src/utils/token.js";
import { authMiddleware } from "../src/middleware/authMiddleware.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_AUTH_TESTS");
const password = "Netsleuth-test-password-42!";

test("middleware verifies JWT cookies without querying the database", async (t) => {
  t.mock.method(db, "select", () => { throw new Error("Middleware must not query PostgreSQL"); });
  const userId = randomUUID();
  const token = signToken(userId, "access", 60);
  const app = express();
  app.use((req, _res, next) => { req.cookies = { netsleuth_access: token }; next(); });
  app.get("/", authMiddleware, (req, res) => res.json({ userId: req.userId }));
  const response = await request(app).get("/");
  assert.equal(response.status, 200);
  assert.equal(response.body.userId, userId);
});

test("stateless cookie authentication with real PostgreSQL, isolated and rolled back", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
  try {
    const database = drizzle(client, { schema });
    try {
      await database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
        await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", pg_catalog`));
        const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
        for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
          const migration = await readFile(new URL(name, directory), "utf8");
          await transaction.execute(sql.raw(migration.replaceAll('"public".', `"${schemaName}".`)));
        }
        for (const method of ["select", "insert", "update", "delete"] as const) {
          t.mock.method(db, method, transaction[method].bind(transaction));
        }
        const app = createApp(async () => {});
        const browser = request.agent(app);
        const base = "/api/v1/auth";
        const email = `auth-${randomUUID()}@example.invalid`;
        let userId = "";
        let accessCookie = "";
        let refreshCookie = "";

        await t.test("registration needs no CSRF, stores bcrypt, and returns safe user data", async () => {
          const response = await browser.post(`${base}/register`).send({ name: "Test User", email, password });
          assert.equal(response.status, 201);
          userId = response.body.data.user.id;
          assert.deepEqual(Object.keys(response.body.data.user).sort(), ["createdAt", "email", "id", "name", "updatedAt"]);
          const cookies = response.headers["set-cookie"] as string[];
          accessCookie = cookies.find((value) => value.startsWith("netsleuth_access="))!.split(";")[0]!;
          refreshCookie = cookies.find((value) => value.startsWith("netsleuth_refresh="))!.split(";")[0]!;
          assert.ok(cookies.every((cookie) => cookie.includes("HttpOnly")));
          assert.equal(response.body.data.accessToken, undefined);
          assert.equal(response.body.data.refreshToken, undefined);
          const [stored] = await transaction.select().from(users).where(eq(users.id, userId));
          assert.ok(stored && await bcrypt.compare(password, stored.passwordHash));
        });

        await t.test("duplicate email and invalid input are rejected", async () => {
          assert.equal((await request(app).post(`${base}/register`)
            .send({ name: "Duplicate", email: email.toUpperCase(), password })).status, 409);
          assert.equal((await request(app).post(`${base}/register`)
            .send({ name: "", email: "bad", password: "short" })).status, 400);
          assert.equal((await request(app).post(`${base}/register`)
            .send({ name: "Test", email, password: "é".repeat(40) })).status, 400);
        });

        await t.test("me reads the current user from PostgreSQL without exposing passwords", async () => {
          await transaction.update(users).set({ name: "Updated User" }).where(eq(users.id, userId));
          const response = await browser.get(`${base}/me`);
          assert.equal(response.status, 200);
          assert.equal(response.body.data.user.name, "Updated User");
          assert.equal(response.body.data.user.passwordHash, undefined);
        });

        await t.test("missing, invalid, expired, wrong-type and Bearer-only tokens fail", async () => {
          assert.equal((await request(app).get(`${base}/me`)).status, 401);
          assert.equal((await request(app).get(`${base}/me`)
            .set("Authorization", `Bearer ${accessCookie.split("=")[1]}`)).status, 401);
          for (const token of ["invalid-token", signToken(userId, "access", -1), signToken(userId, "refresh", 60)]) {
            assert.equal((await request(app).get(`${base}/me`)
              .set("Cookie", `netsleuth_access=${token}`)).status, 401);
          }
        });

        await t.test("refresh verifies its cookie and issues new cookies without session rows", async () => {
          assert.equal((await browser.post(`${base}/refresh`)).status, 200);
          // With stateless refresh, an older unexpired token still works.
          assert.equal((await request(app).post(`${base}/refresh`).set("Cookie", refreshCookie)).status, 200);
          assert.equal((await request(app).post(`${base}/refresh`)).status, 401);
          for (const token of ["invalid-token", signToken(userId, "refresh", -1), signToken(userId, "access", 60)]) {
            assert.equal((await request(app).post(`${base}/refresh`)
              .set("Cookie", `netsleuth_refresh=${token}`)).status, 401);
          }
          assert.equal((await transaction.select().from(refreshSessions)).length, 0);
        });

        await t.test("logout clears cookies but cannot revoke copied JWTs", async () => {
          assert.equal((await browser.post(`${base}/logout`)).status, 200);
          assert.equal((await browser.get(`${base}/me`)).status, 401);
          assert.equal((await request(app).get(`${base}/me`).set("Cookie", accessCookie)).status, 200);
          assert.equal((await request(app).post(`${base}/refresh`).set("Cookie", refreshCookie)).status, 200);
          assert.equal((await browser.post(`${base}/logout`)).status, 200);
        });

        await t.test("login needs only email/password and never creates a session row", async () => {
          assert.equal((await browser.post(`${base}/login`).send({ email, password })).status, 200);
          assert.equal((await browser.get(`${base}/me`)).status, 200);
          const wrong = await request(app).post(`${base}/login`).send({ email, password: "Incorrect-password!" });
          const absent = await request(app).post(`${base}/login`).send({ email: "absent@example.invalid", password });
          assert.equal(wrong.status, 401);
          assert.equal(absent.status, 401);
          assert.equal(wrong.body.message, absent.body.message);
          assert.equal((await transaction.select().from(refreshSessions)).length, 0);
        });

        await t.test("deleted users cannot load me or refresh, and the CSRF endpoint is removed", async () => {
          await transaction.delete(users).where(eq(users.id, userId));
          assert.equal((await browser.get(`${base}/me`)).status, 401);
          assert.equal((await browser.post(`${base}/refresh`)).status, 401);
          assert.equal((await browser.get(`${base}/csrf`)).status, 404);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    assert.equal(remaining.rowCount, 0, "Authentication test schema survived rollback");
  } finally {
    client.release(true);
    await pool.end();
  }
});
