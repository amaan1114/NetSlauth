// Compatibility entry point for the retained starter API.
// NetSleuth's database implementation lives in packages/database.
import { createDatabase } from "@workspace/netsleuth-database";

export const { db, pool } = createDatabase();
export * from "@workspace/netsleuth-database/schema";
