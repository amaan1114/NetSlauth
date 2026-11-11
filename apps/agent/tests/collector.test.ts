import assert from "node:assert/strict";
import test from "node:test";
import { networkEventSchema } from "@workspace/netsleuth-shared";
import { collectNetworkObservations, getNewConnectionEvents, parseSsOutput, MAX_TRACKED_CONNECTIONS } from "../src/collectors/networkCollector.js";
import { logger } from "../src/utils/logger.js";

const timestamp = "2026-11-09T07:00:00.000Z";
const connected = "tcp ESTAB 0 0 192.0.2.10:45123 198.51.100.20:443";

test("ss parsing captures TCP, UDP, IPv4/IPv6, local services and exposed connection states", () => {
  const observations = parseSsOutput([
    connected,
    "tcp SYN-SENT 0 1 192.0.2.10:45124 198.51.100.20:5432",
    "tcp SYN-RECV 0 0 192.0.2.10:5432 198.51.100.20:45125",
    "tcp6 ESTAB 0 0 [2001:db8::1]:45000 [2001:db8::2]:443",
    "tcp LISTEN 0 128 0.0.0.0:5432 0.0.0.0:*",
    "udp UNCONN 0 0 127.0.0.1:53 0.0.0.0:*",
    "udp ESTAB 0 0 192.0.2.10:45126 198.51.100.20:53",
    "tcp6 ESTAB 0 0 [fe80::1%eth0]:45000 [fe80::2%eth0]:443",
  ].join("\n"), timestamp);
  assert.equal(observations.length, 8);
  assert.equal(observations[0]!.sourceIp, "192.0.2.10");
  assert.equal(observations[0]!.destinationPort, 443);
  assert.equal(observations[1]!.eventType, "NETWORK_CONNECTION_ATTEMPT");
  assert.equal(observations[2]!.sourceIp, "198.51.100.20");
  assert.equal(observations[2]!.destinationPort, 5432);
  assert.equal(observations[3]!.sourceIp, "2001:db8::1");
  assert.equal(observations[4]!.eventType, "SERVICE_DISCOVERED");
  assert.equal(observations[4]!.metadata?.observation, "bound_socket_not_verified_service");
  assert.equal(observations[5]!.protocol, "UDP");
  assert.equal(observations[6]!.metadata?.observation, "udp_peer_association_not_handshake");
  assert.equal(observations[7]!.sourceIp, "fe80::1");
  for (const event of getNewConnectionEvents(observations, new Set()).events) {
    assert.equal(networkEventSchema.safeParse(event).success, true);
    assert.equal(event.occurredAt, timestamp);
    assert.equal(event.eventType.startsWith("AUTHENTICATION_"), false);
  }
});

test("headers, malformed data, unknown/wildcard addresses, bad ports and unsupported states are skipped", () => {
  assert.deepEqual(parseSsOutput([
    "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port",
    "bad output",
    "unix ESTAB 0 0 path socket",
    "tcp ESTAB 0 0 999.0.0.1:20 198.51.100.1:443",
    "tcp ESTAB x 0 192.0.2.1:20 198.51.100.1:443",
    "tcp ESTAB 0 0 192.0.2.1:65536 198.51.100.1:443",
    "tcp ESTAB 0 0 192.0.2.1:20 198.51.100.1:abc",
    "tcp TIME-WAIT 0 0 192.0.2.1:20 198.51.100.1:443",
    "tcp LISTEN 0 0 *:443 *:*",
    "tcp ESTAB 0 0 192.0.2.1:20 *:*",
  ].join("\n")), []);
});

test("new connections emit UUIDs once; unchanged sockets do not repeat; transitions and reappearance emit", () => {
  const first = getNewConnectionEvents(parseSsOutput(`${connected}\n${connected}`, timestamp), new Set());
  assert.equal(first.events.length, 1);
  const unchanged = getNewConnectionEvents(parseSsOutput(connected), first.connections);
  assert.equal(unchanged.events.length, 0);
  const gone = getNewConnectionEvents([], unchanged.connections);
  const returned = getNewConnectionEvents(parseSsOutput(connected), gone.connections);
  assert.equal(returned.events.length, 1);
  assert.notEqual(returned.events[0]!.eventId, first.events[0]!.eventId);
  const pending = getNewConnectionEvents(parseSsOutput(connected.replace("ESTAB", "SYN-SENT")), new Set());
  assert.equal(getNewConnectionEvents(parseSsOutput(connected), pending.connections).events.length, 1);
});

test("connection tracking is bounded", (t) => {
  t.mock.method(logger, "error", () => {});
  const rows = Array.from({ length: MAX_TRACKED_CONNECTIONS + 1 }, (_, index) =>
    `tcp ESTAB 0 0 192.0.2.1:${index + 1} 198.51.100.1:443`);
  const snapshot = getNewConnectionEvents(parseSsOutput(rows.join("\n")), new Set());
  assert.equal(snapshot.connections.size, MAX_TRACKED_CONNECTIONS);
  assert.equal(snapshot.events.length, MAX_TRACKED_CONNECTIONS);
});

test("ss runs without a shell, credentials or application process details", { skip: process.platform !== "linux" }, async () => {
  let called = false;
  const observations = await collectNetworkObservations(undefined, async (file, args, options) => {
    called = true;
    assert.equal(file, "ss");
    assert.deepEqual(args, ["-H", "-n", "-t", "-u", "-a"]);
    assert.deepEqual(Object.keys(options.env!).sort(), ["LC_ALL", "PATH"]);
    assert.equal(options.timeout, 5000);
    return { stdout: connected, stderr: "" };
  });
  assert.equal(called, true);
  assert.equal(observations?.length, 1);
});

test("missing ss, permission and execution errors are safe failed snapshots, not empty successful snapshots", { skip: process.platform !== "linux" }, async (t) => {
  const messages: string[] = [];
  t.mock.method(logger, "error", (message: string) => messages.push(message));
  for (const code of ["ENOENT", "EACCES", "EPERM", "ETIMEDOUT"]) {
    const observations = await collectNetworkObservations(undefined, async () => {
      throw Object.assign(new Error("must-not-be-logged"), { code });
    });
    assert.equal(observations, null);
  }
  assert.match(messages[0]!, /ss is unavailable/);
  assert.match(messages[1]!, /Permission denied/);
  assert.equal(messages.join("\n").includes("must-not-be-logged"), false);
});
