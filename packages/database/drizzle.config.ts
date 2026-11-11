import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

loadDotenv({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // Generation is offline; commands that connect require a real DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
