import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_EVENT_FILTERS, isExactIpAddress, makeEventListUrl, validateEventFilters, eventListIsUsable } from "../src/lib/events-explorer.ts";

test("event IP validation matches shared IPv4/IPv6 schema", () => {
  for (const ip of ["192.0.2.1", "::1", "2001:db8::2", "::ffff:192.0.2.1"]) assert.equal(isExactIpAddress(ip), true, ip);
  for (const ip of ["192.0", "256.0.0.1", "2001:::1", "2001:db8::x", "192.0.2.0/24", "fe80::1%eth0"]) assert.equal(isExactIpAddress(ip), false, ip);
});

test("event URL includes combined server filters, paging and ISO times while omitting blanks", () => {
  const path = makeEventListUrl("project", {
    ...EMPTY_EVENT_FILTERS, limit: 25, offset: 50,
    sourceIp: " 2001:db8::1 ", protocol: "TCP", start: "2026-11-10T10:00:00Z",
  });
  const url = new URL(path, "https://example.invalid");
  assert.equal(url.pathname, "/api/v1/projects/project/events");
  assert.equal(url.searchParams.get("sourceIp"), "2001:db8::1");
  assert.equal(url.searchParams.get("protocol"), "TCP");
  assert.equal(url.searchParams.get("offset"), "50");
  assert.equal(url.searchParams.get("start"), "2026-11-10T10:00:00.000Z");
  assert.equal(url.searchParams.has("destinationIp"), false);
  assert.equal(url.searchParams.has("agentId"), false);
});

test("invalid exact filters and reversed time windows block requests", () => {
  assert.deepEqual(validateEventFilters(EMPTY_EVENT_FILTERS), []);
  assert.equal(validateEventFilters({
    ...EMPTY_EVENT_FILTERS, sourceIp: "192.0", agentId: "wrong",
    start: "2026-11-11T00:00:00Z", end: "2026-11-10T00:00:00Z",
  }).length, 3);
  assert.equal(eventListIsUsable({ events: [], pagination: { limit: 25, offset: 0, hasMore: false } }, "own"), true);
  assert.equal(eventListIsUsable({
    events: [{
      id: "event", projectId: "foreign", agentId: "agent", agentName: "Sensor",
      eventType: "AGENT_HEARTBEAT", protocol: "OTHER", sourceIp: "::1",
      sourcePort: null, destinationIp: "::1", destinationPort: null,
      occurredAt: "2026-11-10T00:00:00Z",
    }],
    pagination: { limit: 25, offset: 0, hasMore: false },
  }, "own"), false);
});
