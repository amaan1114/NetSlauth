import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config/index.js";

const agentKey = `ns_agent_${"a".repeat(64)}`;
const env = { NETSLEUTH_API_URL: "https://api.example.invalid/", NETSLEUTH_AGENT_KEY: agentKey };

test("configuration requires a valid base URL/key and supplies the requested defaults", () => {
  assert.deepEqual(readConfig(env), {
    apiUrl: "https://api.example.invalid", agentKey, collectionIntervalMs: 10000, heartbeatIntervalMs: 30000,
  });
  assert.equal(readConfig({ ...env, COLLECTION_INTERVAL_MS: "15000", HEARTBEAT_INTERVAL_MS: "40000" }).collectionIntervalMs, 15000);
  assert.throws(() => readConfig({}), /NETSLEUTH_API_URL/);
  assert.throws(() => readConfig({ NETSLEUTH_API_URL: env.NETSLEUTH_API_URL }), /NETSLEUTH_AGENT_KEY/);
});

test("production requires HTTPS; unsafe URLs and unbounded polling intervals fail without echoing secrets", () => {
  assert.throws(() => readConfig({ ...env, NODE_ENV: "production", NETSLEUTH_API_URL: "http://localhost:4000" }), /HTTPS/);
  assert.equal(readConfig({ ...env, NODE_ENV: "development", NETSLEUTH_API_URL: "http://localhost:4000" }).apiUrl, "http://localhost:4000");
  for (const url of ["ftp://api.example.invalid", "https://person:password@api.example.invalid", "https://api.example.invalid?key=secret", "https://api.example.invalid/#fragment"]) {
    assert.throws(() => readConfig({ ...env, NETSLEUTH_API_URL: url }));
  }
  for (const value of ["0", "-1", "oops", "1000.5", "3600001", ""]) {
    assert.throws(() => readConfig({ ...env, COLLECTION_INTERVAL_MS: value }), /COLLECTION_INTERVAL_MS/);
    assert.throws(() => readConfig({ ...env, HEARTBEAT_INTERVAL_MS: value }), /HEARTBEAT_INTERVAL_MS/);
  }
  assert.throws(() => readConfig({ ...env, NETSLEUTH_AGENT_KEY: "invalid-credential" }), (error: Error) =>
    !error.message.includes("invalid-credential"));
});
