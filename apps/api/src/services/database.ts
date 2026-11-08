import { createDatabase } from "@workspace/netsleuth-database";
import { sql } from "drizzle-orm";
import { env } from "../config/env.js";

export const { db, pool } = createDatabase(env.DATABASE_URL);
// Set bounds before the pool opens its first connection.
pool.options.connectionTimeoutMillis = 3000;
pool.options.query_timeout = 3000;
pool.options.statement_timeout = 3000;

export async function checkDatabase(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
