import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventSpool } from "../src/services/eventSpool.js";
import type { NetworkEventInput } from "../src/types/index.js";

const event = (eventId: string): NetworkEventInput => ({
  eventId,
  eventType: "NETWORK_CONNECTION_ESTABLISHED",
  sourceIp: "127.0.0.1",
  sourcePort: 1000,
  destinationIp: "127.0.0.1",
  destinationPort: 2000,
  protocol: "TCP",
  occurredAt: new Date().toISOString(),
  metadata: {},
});

test("event spool survives restart and acknowledges only delivered events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "netsleuth-spool-"));
  const path = join(directory, "events.json");
  try {
    const first = new EventSpool(path);
    await first.enqueue([event("one"), event("two")]);
    const restarted = new EventSpool(path);
    assert.deepEqual((await restarted.take(10)).map((item) => item.eventId), ["one", "two"]);
    await restarted.acknowledge(1);
    assert.deepEqual((await new EventSpool(path).take(10)).map((item) => item.eventId), ["two"]);
    assert.equal((await readFile(path, "utf8")).includes("one"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
