import "dotenv/config";
import type { CookieOptions } from "express";
import { z } from "zod";

const result = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(2592000).default(604800),
    COOKIE_SECURE: z.enum(["true", "false"]).optional().transform((value) => value === undefined ? process.env.NODE_ENV === "production" : value === "true"),
    COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
    COOKIE_DOMAIN: z.string().min(1).optional(),
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
  .superRefine((config, context) => {
    if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_REFRESH_SECRET"], message: "Access and refresh secrets must be different" });
    }
    if ((config.NODE_ENV === "production" || config.COOKIE_SAME_SITE === "none") && !config.COOKIE_SECURE) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["COOKIE_SECURE"], message: "Secure cookies are required in production and for SameSite=None" });
    }
    if (config.JWT_REFRESH_TTL_SECONDS <= config.JWT_ACCESS_TTL_SECONDS) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_REFRESH_TTL_SECONDS"], message: "Refresh lifetime must exceed access lifetime" });
    }
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

export const cookieConfig: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  path: "/",
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

export const refreshCookieConfig: CookieOptions = {
  ...cookieConfig,
  path: "/api/v1/auth",
};
