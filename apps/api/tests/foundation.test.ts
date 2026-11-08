import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { z } from "zod";

// No live connection is opened by these unit tests. Real readiness is checked
// separately against the running server, not represented by these test doubles.
process.env.DATABASE_URL ??= "postgresql://localhost/netsleuth_test";
const { createApp } = await import("../src/app.js");
const { globalErrorHandler } = await import("../src/middleware/globalErrorHandler.js");
const { HttpError } = await import("../src/utils/HttpError.js");
const { pool } = await import("../src/services/database.js");
after(() => pool.end());

test("liveness uses the standard success envelope and security headers", async () => {
  const response = await request(createApp(async () => {})).get("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true, statusCode: 200, message: "API is running", data: { status: "ok" },
  });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("readiness succeeds only after the database check completes", async () => {
  let checked = false;
  const response = await request(createApp(async () => { checked = true; })).get("/health/ready");
  assert.equal(checked, true);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.database, "connected");
});

test("unavailable PostgreSQL returns 503 without internal connection details", async () => {
  const response = await request(createApp(async () => {
    throw new Error("internal connection details");
  })).get("/health/ready");
  assert.deepEqual(response.body, {
    success: false, statusCode: 503, message: "Database is unavailable",
  });
  assert.equal(response.status, 503);
});

test("unknown routes return a consistent JSON 404", async () => {
  const response = await request(createApp()).get("/api/unknown");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { success: false, statusCode: 404, message: "Route not found" });
});

test("malformed JSON returns 400, not an internal error or stack trace", async () => {
  const response = await request(createApp()).post("/unknown")
    .set("Content-Type", "application/json").send('{"broken":');
  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid JSON body");
  assert.equal(response.body.stack, undefined);
});

test("body size limits return a JSON 413", async () => {
  const response = await request(createApp()).post("/unknown")
    .send({ value: "x".repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.equal(response.body.success, false);
});

test("global handler supports HttpError, Zod validation and unexpected failures", async () => {
  const app = express();
  app.get("/known", () => { throw new HttpError(409, "Conflict", { field: "name" }); });
  app.get("/validation", () => { z.object({ name: z.string() }).parse({}); });
  app.get("/unexpected", () => { throw new Error("secret internal message"); });
  app.use(globalErrorHandler);
  const known = await request(app).get("/known");
  assert.equal(known.status, 409);
  assert.deepEqual(known.body.errors, { field: "name" });
  const validation = await request(app).get("/validation");
  assert.equal(validation.status, 400);
  assert.equal(validation.body.errors[0].path, "name");
  const unexpected = await request(app).get("/unexpected");
  assert.equal(unexpected.status, 500);
  assert.deepEqual(unexpected.body, {
    success: false, statusCode: 500, message: "Internal server error",
  });
});

test("API-prefixed health and legacy probe remain reachable", async () => {
  const app = createApp(async () => {});
  assert.equal((await request(app).get("/api/health")).status, 200);
  assert.equal((await request(app).get("/api/health/ready")).status, 200);
  assert.deepEqual((await request(app).get("/api/healthz")).body, { status: "ok" });
});
