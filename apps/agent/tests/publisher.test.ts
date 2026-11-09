import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { networkEventSchema } from "@workspace/netsleuth-shared";
import { publishEvents } from "../src/services/eventPublisher.js";
import { createHeartbeatEvent, publishHeartbeat } from "../src/services/heartbeat.js";
import { startTestApi, sendCounts } from "./http.js";
import type { AgentConfig, NetworkEventInput } from "../src/types/index.js";

const config = (apiUrl: string): AgentConfig => ({
  apiUrl, agentKey: `ns_agent_${"b".repeat(64)}`, collectionIntervalMs: 10000, heartbeatIntervalMs: 30000,
});
const event = (): NetworkEventInput => ({
  eventId: randomUUID(), eventType: "NETWORK_CONNECTION_ESTABLISHED", sourceIp: "192.0.2.1",
  destinationIp: "198.51.100.1", destinationPort: 443, protocol: "TCP", occurredAt: new Date().toISOString(),
});
const quick = { retryDelayMs: 1, timeoutMs: 1000 };

test("publishing uses only X-Agent-Key, the actual envelope and batches of at most 100", async (t) => {
  const sizes: number[] = [];
  const api = await startTestApi((events, req, res) => {
    assert.equal(req.url, "/api/v1/ingest/events");
    assert.equal(req.headers["x-agent-key"], config(api.url).agentKey);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    sizes.push(events.length);
    sendCounts(res, events.length);
  });
  t.after(api.close);
  const result = await publishEvents(config(api.url), Array.from({ length: 201 }, event), undefined, quick);
  assert.deepEqual(sizes, [100, 100, 1]);
  assert.deepEqual(result, { insertedCount: 201, duplicateCount: 0 });
});

test("temporary 429/503 responses retry with the same UUIDs and accept duplicate acknowledgements", async (t) => {
  const bodies: string[] = [];
  const api = await startTestApi((events, _req, res) => {
    bodies.push(JSON.stringify(events));
    if (bodies.length < 3) { res.writeHead(bodies.length === 1 ? 429 : 503).end(); return; }
    sendCounts(res, 0, events.length);
  });
  t.after(api.close);
  const result = await publishEvents(config(api.url), [event()], undefined, quick);
  assert.equal(bodies.length, 3);
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(result, { insertedCount: 0, duplicateCount: 1 });
});

test("temporary network disconnect is retried with a bounded policy", async (t) => {
  let requests = 0;
  const api = await startTestApi((events, req, res) => {
    requests++;
    if (requests === 1) { req.socket.destroy(); return; }
    sendCounts(res, events.length);
  });
  t.after(api.close);
  assert.equal((await publishEvents(config(api.url), [event()], undefined, quick)).insertedCount, 1);
  assert.equal(requests, 2);
});

test("timeouts during headers or successful-response body are retried without changing event IDs", async (t) => {
  for (const flushHeaders of [false, true]) {
    const ids: string[] = [];
    const api = await startTestApi((events, _req, res) => {
      ids.push(events[0]!.eventId);
      if (ids.length === 1) {
        if (flushHeaders) { res.writeHead(200, { "Content-Type": "application/json" }); res.flushHeaders(); }
        return;
      }
      sendCounts(res, 0, events.length);
    });
    t.after(api.close);
    const result = await publishEvents(config(api.url), [event()], undefined, { ...quick, timeoutMs: 50 });
    assert.deepEqual(result, { insertedCount: 0, duplicateCount: 1 });
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
    await api.close();
  }
});

test("permanent 401 and malformed successful envelopes fail explicitly without retry", async (t) => {
  for (const kind of ["unauthorized", "invalid-envelope"]) {
    let requests = 0;
    const api = await startTestApi((_events, _req, res) => {
      requests++;
      if (kind === "unauthorized") res.writeHead(401).end("must not log response content");
      else sendCounts(res, 999);
    });
    t.after(api.close);
    await assert.rejects(publishEvents(config(api.url), [event()], undefined, quick));
    assert.equal(requests, 1);
    await api.close();
  }
});

test("persistent server failures stop at the configured attempt count", async (t) => {
  let requests = 0;
  const api = await startTestApi((_events, _req, res) => { requests++; res.writeHead(503).end(); });
  t.after(api.close);
  await assert.rejects(publishEvents(config(api.url), [event()], undefined, quick), /bounded retries/);
  assert.equal(requests, 3);
});

test("redirects never forward credentials to another endpoint", async (t) => {
  let forwarded = 0;
  const target = await startTestApi((_events, _req, res) => { forwarded++; res.end(); });
  const api = await startTestApi((_events, _req, res) => { res.writeHead(307, { Location: target.url }).end(); });
  t.after(api.close);
  t.after(target.close);
  await assert.rejects(publishEvents(config(api.url), [event()], undefined, { ...quick, maxAttempts: 1 }));
  assert.equal(forwarded, 0);
});

test("heartbeat uses the existing shared event schema and ingestion endpoint", async (t) => {
  const first = createHeartbeatEvent();
  assert.equal(networkEventSchema.safeParse(first).success, true);
  assert.notEqual(first.eventId, createHeartbeatEvent().eventId);
  const api = await startTestApi((events, _req, res) => {
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "AGENT_HEARTBEAT");
    assert.equal(events[0]!.protocol, "OTHER");
    assert.equal(events[0]!.metadata?.observation, "local_control_heartbeat_not_network_traffic");
    sendCounts(res, 1);
  });
  t.after(api.close);
  assert.deepEqual(await publishHeartbeat(config(api.url)), { insertedCount: 1, duplicateCount: 0 });
});

test("cancelled publishing sends no requests or retries", async (t) => {
  let requests = 0;
  const api = await startTestApi((_events, _req, res) => { requests++; res.end(); });
  t.after(api.close);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(publishEvents(config(api.url), [event()], controller.signal, quick));
  assert.equal(requests, 0);
});
