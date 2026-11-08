import "dotenv/config";
import { z } from "zod";

const result = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (url) =>
          url.startsWith("postgres://") || url.startsWith("postgresql://"),
        "Must be a PostgreSQL connection URL",
      ),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) => value.split(",").map((origin) => origin.trim()))
      .pipe(z.array(z.string().url()).min(1)),
  })
  .safeParse(process.env);

if (!result.success) {
  // Show invalid field names/messages, never connection strings or credentials.
  throw new Error(
    `Invalid API environment: ${result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}

export const env = result.data;
