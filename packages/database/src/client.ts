import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

// Call once at application startup. Importing schema/types does not open a pool.
export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create the database client.");
  }

  const pool = new pg.Pool({ connectionString });
  pool.on("error", () => {
    console.error("Unexpected error on an idle PostgreSQL connection.");
  });

  const db = drizzle(pool, { schema });
  return { db, pool };
}

// Queries work with either a pool-backed database or a transaction-bound client.
export type Database = NodePgDatabase<typeof schema>;
