import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Use the canonical source directly so Drizzle Kit does not load the
  // compatibility wrapper through its CommonJS TypeScript loader.
  schema: path.join(__dirname, "../../packages/database/src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
