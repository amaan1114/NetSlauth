import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/schema/index.js";
import { checkQueryScopes } from "./scopes.js";

test("generated migration, database constraints, and real scoped query helpers", async () => {
  // Deliberately no fallback to DATABASE_URL or dotenv: this command is opt-in.
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, "Set TEST_DATABASE_URL to a disposable PostgreSQL database to run test:db.");
  const migration = await readFile(new URL("../drizzle/0000_netsleuth_initial.sql", import.meta.url), "utf8");
  const constraints = await readFile(new URL("./constraints.sql", import.meta.url), "utf8");
  // Generated locally, never user-supplied; fits PostgreSQL's 63-byte identifier limit.
  const schemaName = `netsleuth_test_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  const isolatedMigration = migration.replaceAll('"public".', `${quotedSchema}.`);
  const pool = new pg.Pool({
    connectionString, max: 1, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000,
  });
  const failures: unknown[] = [];

  try {
    const client = await pool.connect();
    let discardConnection = false;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      // No public fallback: a missing test table must fail, not hit application data.
      await client.query(`SET LOCAL search_path TO ${quotedSchema}, pg_catalog`);
      await client.query(isolatedMigration);
      await client.query(constraints);
      // Drizzle must use THIS client, not the pool (which could escape the transaction).
      await checkQueryScopes(drizzle(client, { schema }));
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await client.query("ROLLBACK");
        const remaining = await client.query(
          "SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1", [schemaName],
        );
        assert.equal(remaining.rowCount, 0, "test schema survived rollback");
      } catch (error) {
        // Closing a broken connection also rolls back its open transaction server-side.
        discardConnection = true;
        failures.push(error);
      } finally {
        client.release(discardConnection);
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    // Also runs if connection acquisition, migration, SQL checks, or helpers fail.
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Database checks or cleanup failed");
  }
});
