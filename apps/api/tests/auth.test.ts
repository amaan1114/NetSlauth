import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, test } from "node:test";
import bcrypt from "bcrypt";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createDatabase, users, refreshSessions, type Database } from "@workspace/netsleuth-database";
import * as schema from "@workspace/netsleuth-database/schema";
import { createApp } from "../src/app.js";
import { pool as applicationPool } from "../src/services/database.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../src/modules/auth/auth.cookies.js";
import { signToken } from "../src/modules/auth/auth.tokens.js";

after(() => applicationPool.end());
const rollback = new Error("ROLLBACK_AUTH_TESTS");
const password = "Netsleuth-test-password-42!";

test("cookie authentication with real PostgreSQL, isolated and rolled back", async (t) => {
  const { pool } = createDatabase();
  const client = await pool.connect();
  const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
  try {
    const database = drizzle(client, { schema });
    try {
      // Drizzle manages the outer transaction so registration's nested
      // transaction uses a savepoint, never commits the test fixture schema.
      await database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
        await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", pg_catalog`));
        const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
        for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
          const migration = await readFile(new URL(name, directory), "utf8");
          await transaction.execute(sql.raw(migration.replaceAll('"public".', `"${schemaName}".`)));
        }
        const testDatabase = transaction as unknown as Database;
        const app = createApp(async () => {}, testDatabase);
        const base = "/api/v1/auth";

        class Browser {
          cookies = new Map<string, string>();
          async call(method: "get" | "post", path: string, body?: unknown, headers: Record<string, string> = {}) {
            let pending = request(app)[method](`${base}${path}`)
              .set("Cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`)).set(headers);
            if (body !== undefined) pending = pending.send(body);
            const response = await pending;
            for (const cookie of response.headers["set-cookie"] ?? []) {
              const first = cookie.split(";")[0]!;
              const separator = first.indexOf("=");
              const name = first.slice(0, separator);
              const value = first.slice(separator + 1);
              if (value) this.cookies.set(name, value);
              else this.cookies.delete(name);
            }
            return response;
          }
          async mutate(path: string, body?: unknown) {
            const csrf = await this.call("get", "/csrf");
            return this.call("post", path, body, { "X-CSRF-Token": csrf.body.data.csrfToken });
          }
        }

        const browser = new Browser();
        const email = `auth-${randomUUID()}@example.invalid`;
        let userId = "";
        let initialAccess = "";
        let initialRefresh = "";

        await t.test("registration stores a bcrypt hash and returns only safe user data", async () => {
          const response = await browser.mutate("/register", { name: "Test User", email, password });
          assert.equal(response.status, 201);
          userId = response.body.data.user.id;
          assert.deepEqual(Object.keys(response.body.data.user).sort(), ["createdAt", "email", "id", "name", "updatedAt"]);
          assert.equal(response.body.data.accessToken, undefined);
          assert.equal(response.body.data.refreshToken, undefined);
          initialAccess = browser.cookies.get(ACCESS_COOKIE)!;
          initialRefresh = browser.cookies.get(REFRESH_COOKIE)!;
          assert.ok(initialAccess && initialRefresh);
          assert.ok(response.headers["set-cookie"].every((cookie: string) => cookie.includes("HttpOnly")));
          const [stored] = await testDatabase.select().from(users).where(eq(users.id, userId));
          assert.ok(stored);
          assert.ok(stored.passwordHash.startsWith("$2b$"));
          assert.ok(await bcrypt.compare(password, stored.passwordHash));
          const [session] = await testDatabase.select().from(refreshSessions).where(eq(refreshSessions.userId, userId));
          assert.ok(session && /^[a-f0-9]{64}$/.test(session.tokenHash));
          assert.ok(session.tokenHash !== initialRefresh);
        });

        await t.test("duplicate email is rejected case-insensitively", async () => {
          const response = await new Browser().mutate("/register", { name: "Duplicate", email: email.toUpperCase(), password });
          assert.equal(response.status, 409);
        });

        await t.test("invalid registration and bcrypt-overlong passwords are rejected", async () => {
          assert.equal((await new Browser().mutate("/register", { name: "", email: "bad", password: "short" })).status, 400);
          assert.equal((await new Browser().mutate("/register", { name: "Test", email, password: "é".repeat(40) })).status, 400);
        });

        await t.test("missing and wrong CSRF tokens and hostile origins are rejected", async () => {
          assert.equal((await browser.call("post", "/refresh")).status, 403);
          assert.equal((await browser.call("post", "/refresh", {}, { "X-CSRF-Token": "0".repeat(64) })).status, 403);
          const csrf = await browser.call("get", "/csrf");
          assert.equal((await browser.call("post", "/refresh", {}, {
            "X-CSRF-Token": csrf.body.data.csrfToken, Origin: "https://evil.example",
          })).status, 403);
        });

        await t.test("current user is fetched from PostgreSQL", async () => {
          await testDatabase.update(users).set({ name: "Updated Test User" }).where(eq(users.id, userId));
          const response = await browser.call("get", "/me");
          assert.equal(response.status, 200);
          assert.equal(response.body.data.user.name, "Updated Test User");
          assert.equal(response.body.data.user.passwordHash, undefined);
        });

        await t.test("missing/invalid/expired access cookies and Bearer-only requests fail", async () => {
          const visitor = new Browser();
          assert.equal((await visitor.call("get", "/me")).status, 401);
          assert.equal((await visitor.call("get", "/me", undefined, { Authorization: `Bearer ${initialAccess}` })).status, 401);
          visitor.cookies.set(ACCESS_COOKIE, "invalid-token");
          assert.equal((await visitor.call("get", "/me")).status, 401);
          const [session] = await testDatabase.select().from(refreshSessions).where(eq(refreshSessions.userId, userId));
          visitor.cookies.set(ACCESS_COOKIE, signToken(userId, session!.id, "access", -1));
          assert.equal((await visitor.call("get", "/me")).status, 401);
          visitor.cookies.set(ACCESS_COOKIE, initialRefresh);
          assert.equal((await visitor.call("get", "/me")).status, 401);
        });

        await t.test("refresh rotates both cookies and rejects the old refresh token", async () => {
          const response = await browser.mutate("/refresh");
          assert.equal(response.status, 200);
          assert.ok(browser.cookies.get(REFRESH_COOKIE) !== initialRefresh);
          assert.ok(browser.cookies.get(ACCESS_COOKIE) !== initialAccess);
          const replay = new Browser();
          replay.cookies.set(REFRESH_COOKIE, initialRefresh);
          assert.equal((await replay.mutate("/refresh")).status, 401);
          assert.equal((await browser.call("get", "/me")).status, 200);
        });

        await t.test("concurrent refresh requests allow exactly one rotation", async () => {
          const first = new Browser();
          const second = new Browser();
          first.cookies = new Map(browser.cookies);
          second.cookies = new Map(browser.cookies);
          const [a, b] = await Promise.all([first.mutate("/refresh"), second.mutate("/refresh")]);
          assert.deepEqual([a.status, b.status].sort(), [200, 401]);
          browser.cookies = new Map(a.status === 200 ? first.cookies : second.cookies);
        });

        await t.test("invalid and expired refresh JWTs are rejected", async () => {
          const visitor = new Browser();
          visitor.cookies.set(REFRESH_COOKIE, "invalid-token");
          assert.equal((await visitor.mutate("/refresh")).status, 401);
          const [session] = await testDatabase.select().from(refreshSessions).where(eq(refreshSessions.userId, userId));
          visitor.cookies.set(REFRESH_COOKIE, signToken(userId, session!.id, "refresh", -1));
          assert.equal((await visitor.mutate("/refresh")).status, 401);
        });

        await t.test("logout clears cookies and immediately invalidates saved access/refresh tokens", async () => {
          const stolenAccess = browser.cookies.get(ACCESS_COOKIE)!;
          const stolenRefresh = browser.cookies.get(REFRESH_COOKIE)!;
          const response = await browser.mutate("/logout");
          assert.equal(response.status, 200);
          assert.ok(!browser.cookies.has(ACCESS_COOKIE) && !browser.cookies.has(REFRESH_COOKIE));
          const replay = new Browser();
          replay.cookies.set(ACCESS_COOKIE, stolenAccess);
          replay.cookies.set(REFRESH_COOKIE, stolenRefresh);
          assert.equal((await replay.call("get", "/me")).status, 401);
          assert.equal((await replay.mutate("/refresh")).status, 401);
        });

        await t.test("login succeeds with correct credentials and gives generic failures otherwise", async () => {
          assert.equal((await browser.mutate("/login", { email, password })).status, 200);
          assert.equal((await browser.call("get", "/me")).status, 200);
          const wrong = await new Browser().mutate("/login", { email, password: "Incorrect-password!" });
          const absent = await new Browser().mutate("/login", { email: "absent@example.invalid", password });
          assert.equal(wrong.status, 401);
          assert.equal(absent.status, 401);
          assert.equal(wrong.body.message, absent.body.message);
          assert.ok(!JSON.stringify(wrong.body).includes("passwordHash"));
        });

        await t.test("deleting a user revokes their access through the session foreign key", async () => {
          await testDatabase.delete(users).where(eq(users.id, userId));
          assert.equal((await browser.call("get", "/me")).status, 401);
          assert.equal((await browser.mutate("/refresh")).status, 401);
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
