import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiRequest, apiRequestWithRefresh } from "../src/lib/api.ts";

const success = (data: unknown) => Response.json({
  success: true, statusCode: 200, message: "OK", data,
});
const failure = (status: number) => Response.json({
  success: false, statusCode: status, message: "Request rejected",
}, { status });

afterEach(() => mock.restoreAll());

test("requests include cookies, encode JSON, and unwrap the shared response", async () => {
  const fetch = mock.method(globalThis, "fetch", async (_path, options) => {
    assert.equal(options?.credentials, "include");
    assert.equal(options?.body, JSON.stringify({ name: "Workspace" }));
    assert.equal(new Headers(options?.headers).get("Content-Type"), "application/json");
    assert.equal(new Headers(options?.headers).has("Authorization"), false);
    return success({ id: "workspace-id" });
  });
  assert.deepEqual(await apiRequest("/api/v1/workspaces", {
    method: "POST", body: { name: "Workspace" },
  }), { id: "workspace-id" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("expired access cookies refresh once and retry the original request", async () => {
  const paths: string[] = [];
  mock.method(globalThis, "fetch", async (path) => {
    paths.push(String(path));
    return paths.length === 1 ? failure(401) : success({ user: { id: "user-id" } });
  });
  await apiRequestWithRefresh("/api/v1/auth/me");
  assert.deepEqual(paths, ["/api/v1/auth/me", "/api/v1/auth/refresh", "/api/v1/auth/me"]);
});

test("invalid refresh cookies stop retries and preserve the 401 status", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => failure(401));
  await assert.rejects(apiRequestWithRefresh("/api/v1/auth/me"),
    (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(fetch.mock.callCount(), 2);
});

test("server failures are not treated as expired sessions", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => failure(503));
  await assert.rejects(apiRequestWithRefresh("/api/v1/workspaces"),
    (error: unknown) => error instanceof ApiError && error.status === 503);
  assert.equal(fetch.mock.callCount(), 1);
});

test("network failures remain distinguishable from authentication failures", async () => {
  mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(apiRequestWithRefresh("/api/v1/auth/me"),
    (error: unknown) => error instanceof ApiError && error.isNetworkError && error.status === 0);
});

test("invalid response envelopes fail explicitly", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ unexpected: true }));
  await assert.rejects(apiRequest("/api/v1/auth/me"),
    (error: unknown) => error instanceof ApiError && error.message.includes("invalid response"));
});

test("concurrent unauthorized requests share one refresh request", async () => {
  const calls = new Map<string, number>();
  let refreshCount = 0;
  mock.method(globalThis, "fetch", async (input) => {
    const path = String(input);
    if (path === "/api/v1/auth/refresh") {
      refreshCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return success({});
    }
    const count = (calls.get(path) ?? 0) + 1;
    calls.set(path, count);
    return count === 1 ? failure(401) : success({});
  });
  await Promise.all([
    apiRequestWithRefresh("/api/v1/auth/me"),
    apiRequestWithRefresh("/api/v1/workspaces"),
  ]);
  assert.equal(refreshCount, 1);
  assert.deepEqual([...calls.values()], [2, 2]);
});
