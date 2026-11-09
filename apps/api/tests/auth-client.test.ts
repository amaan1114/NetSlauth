import assert from "node:assert/strict";
import { test } from "node:test";
import { customFetch, setBaseUrl } from "../../../lib/api-client-react/src/custom-fetch.js";

test("frontend transport sends cookies directly without CSRF requests or Authorization", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  };
  setBaseUrl("https://api.example.invalid");
  try {
    await customFetch("/api/v1/auth/login", {
      method: "POST", body: JSON.stringify({ email: "test@example.invalid", password: "test-password" }),
      credentials: "omit", headers: { Authorization: "Bearer not-an-auth-token" },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.example.invalid/api/v1/auth/login");
    assert.ok(calls.every((call) => call.init.credentials === "include"));
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-csrf-token"), null);
    await customFetch("/api/v1/auth/me");
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.init.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});
