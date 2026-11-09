# NetSleuth Linux agent

Lightweight Node.js/TypeScript agent that polls the Linux socket table using
`ss`, publishes new observations to the existing ingestion API, and sends
periodic heartbeats. It has no database, broker, durable queue, packet capture,
automatic blocking, or remediation.

## Requirements and setup

- Linux host or Linux VM, Node.js 22+, pnpm, and the `ss` command from iproute2.
- A running NetSleuth API with a registered agent. Registration returns the
  agent key once through `POST /api/v1/projects/:projectId/agents`.
- Keep the key in the target machine's environment/secret manager or an ignored
  `apps/agent/.env`. Never put it in command-line arguments, source, or Git.

Copy `.env.example` to `.env` and configure it locally:

```env
NETSLEUTH_API_URL=https://your-api.example
NETSLEUTH_AGENT_KEY=
COLLECTION_INTERVAL_MS=10000
HEARTBEAT_INTERVAL_MS=30000
NODE_ENV=production
```

The key is intentionally blank in this example; supply the real key securely.
`NETSLEUTH_API_URL` is the API server's base URL, **not** `/api` or
`/api/v1/ingest/events`. The publisher appends `/api/v1/ingest/events`. A custom
reverse-proxy prefix, if any, belongs in the base URL. URL user-info, query
parameters, and fragments are rejected.

`NODE_ENV=production` requires HTTPS. For a local development API, explicitly
use `NODE_ENV=development` and an HTTP localhost base URL.
Both interval values must be integers from 1000 to 3600000 milliseconds.
Missing/invalid configuration exits with a field-specific error without printing
the value. The package-local `.env` is loaded using Node's built-in support;
existing environment variables take precedence.

From the monorepo root:

```sh
# Build the independent agent and its shared dependency.
pnpm exec turbo run build --filter=@workspace/netsleuth-agent...

# Run compiled JavaScript.
pnpm --filter @workspace/netsleuth-agent start

# Or develop directly from TypeScript, after shared dependencies are built.
pnpm --filter @workspace/netsleuth-agent dev
```

This is a long-running executable, not a web server or a dashboard. Install and
run it on the Linux system/network namespace you intend to observe. No real
agent key is configured automatically by building or testing this package.

## Source structure

```text
src/
  config/index.ts
  collectors/networkCollector.ts
  services/eventPublisher.ts
  services/heartbeat.ts
  utils/logger.ts
  types/index.ts
  index.ts
```

Event types and runtime validation reuse the existing
`@workspace/netsleuth-shared` package. There are no imports from API internals,
database repositories, or the browser client. The existing API contract is
unchanged.

## What it observes

The collector executes a fixed command without a shell:

```sh
ss -H -n -t -u -a
```

The child receives only PATH and a fixed C locale, not the agent key or the
parent's other secrets. No `-p` process information or application payloads are
requested. Collection is limited to five seconds and 4 MiB of output.
Malformed/unsupported rows are skipped. Missing utilities, permission errors,
timeouts, or excessive output are logged as fixed messages; a failed command
does not erase the last successful connection snapshot.

| Observation | Event |
| --- | --- |
| TCP SYN-SENT or SYN-RECV | NETWORK_CONNECTION_ATTEMPT |
| TCP ESTAB | NETWORK_CONNECTION_ESTABLISHED |
| UDP ESTAB | NETWORK_CONNECTION_ESTABLISHED, explicitly marked as a UDP peer association, not a handshake |
| TCP LISTEN or UDP UNCONN with wildcard/unspecified peer and a known local binding | SERVICE_DISCOVERED, explicitly marked as an unverified bound socket |

TCP SYN-SENT uses local-to-peer orientation; SYN-RECV uses peer-to-local.
Established sockets generally do not reveal who initiated the connection, so
source/destination mean local/peer respectively and metadata says direction is
unknown. Do not infer original packet direction from those labels.

Local service events repeat the bound address/port in both endpoint fields;
metadata marks them as local bindings, not remote traffic. An unspecified
binding such as `0.0.0.0` or `::` means all interfaces, not a remote host.
Ambiguous `*` local addresses without a known IP family are skipped rather than
inventing an address. IPv6 scope suffixes are removed for the existing shared
IP format; interface-local distinctions are therefore not preserved.

Each event receives an agent-generated UUID and observation timestamp.
Metadata contains the transport state and interpretation, not process names,
application content, or authentication claims. No AUTHENTICATION_SUCCESS or
AUTHENTICATION_FAILURE events are generated from sockets.

The agent tracks up to 5000 current observations in memory. Unchanged sockets
do not generate events every cycle; a new event type/state transition or a
connection disappearing and later returning can generate a new event.
Restarting the agent resets this snapshot. Initial polling reports currently
visible sockets, not necessarily connections created at that instant.

## Publishing, retries and loss limits

Requests use `X-Agent-Key` only, no browser cookies or Authorization header.
Events are validated with the shared Zod schema and split into batches of at
most 100. The publisher checks the actual success envelope and requires
`insertedCount + duplicateCount` to match the submitted batch length.

Each request has a five-second timeout, including response-body reading.
Network failures, timeouts, HTTP 408/425/429, and server failures receive at
most **three total attempts**, with 500 ms then 1000 ms backoff. The exact body
and UUIDs are retained across retries, so a lost response can safely produce a
duplicate acknowledgement. Permanent client errors and malformed success
responses fail explicitly. Redirects are refused to prevent credential
forwarding. Request errors, response bodies, headers, URLs, and keys are never
logged.

There is intentionally **no offline event buffer**. If a batch exhausts its
retries, the cycle is logged as not fully delivered, and later cycles continue.
Already-visible connections stay in the snapshot, rather than generating fresh
UUIDs indefinitely during an outage. Undelivered observations may be lost, and
a partially successful multi-batch cycle can have some events persisted. This
MVP does not provide guaranteed delivery or complete historical coverage.

The API's existing post-commit detection limitation also remains: a 500 caused
by detection may be followed by a successful duplicate acknowledgement. That
confirms event persistence, not successful detection recovery.

## Heartbeat and shutdown

A heartbeat is sent immediately and then every 30 seconds by default, through
the same ingestion endpoint. Loopback endpoint fields and OTHER protocol are
explicit local-control markers required by the existing schema, not observed
traffic. Heartbeat success proves agent liveness, not collector health or full
network visibility. Failures are logged without terminating socket polling.
Collection cycles and heartbeat cycles each avoid overlapping themselves.

SIGINT/SIGTERM stop both timers and allow pending collection/HTTP work to
finish. After ten seconds, outstanding work and retry waits are cancelled.
Shutdown then removes signal handlers and exits cleanly. No new polls or
heartbeats start once stopping begins.

## Visibility limitations

This is connection-table polling, **not packet-level monitoring**. Short-lived
sockets between polls can be missed, and a socket state does not prove
application activity, a successful database login, or malicious intent. UDP
peer association is not a transport handshake. Socket metadata cannot provide
authentication outcomes; those require actual logs/application evidence.

Visibility is limited by host permissions and the process's network namespace.
On macOS, use a Linux host/VM. In Docker Desktop, a Linux container/VM sees its
own exposed namespace, **not automatically the macOS/Windows host**. Validate
actual target-host visibility on Linux; this workspace's smoke check only
verifies collection inside its Linux namespace.

## Verification

```sh
pnpm --filter @workspace/netsleuth-agent typecheck
pnpm --filter @workspace/netsleuth-agent lint
pnpm --filter @workspace/netsleuth-agent test
pnpm --filter @workspace/netsleuth-agent build
```

Tests use explicit synthetic socket fixtures, ephemeral local HTTP servers, and
test-only keys. They cover IPv4/IPv6 parsing, malformed rows, unavailable `ss`,
permission errors, deduplication, batch bounds, header authentication,
duplicates, bounded retries, header/body timeouts, heartbeat generation,
redirect refusal, configuration, and graceful signal/deadline handling.
No test fixtures are published to the real NetSleuth API.
