# NetSleuth backend foundation

Small Express 5/TypeScript backend with cookie authentication, authorized
workspace/project management, and agent registration/key authentication.
Network event ingestion, initial rule-based detection, project database policies,
and authorized alert listing are implemented. Socket.IO application events are
not implemented.

## Structure

```text
src/
  config/env.ts
  middleware/
    globalErrorHandler.ts
    requestLogger.ts
    authMiddleware.ts
  modules/auth/
    auth.routes.ts
    auth.controller.ts
    auth.service.ts
    auth.validation.ts
    auth.repo.ts
  modules/workspaces/
    workspace.routes.ts
    workspace.controller.ts
    workspace.service.ts
    workspace.repo.ts
    workspace.validation.ts
  modules/projects/
    project.routes.ts
    project.controller.ts
    project.service.ts
    project.repo.ts
    project.validation.ts
  modules/agents/
    agent.routes.ts
    agent.controller.ts
    agent.service.ts
    agent.repo.ts
    agent.validation.ts
    agent.middleware.ts
  modules/events/
    event.routes.ts
    event.controller.ts
    event.service.ts
    event.validation.ts
  modules/detections/
    detection.service.ts
  modules/alerts/
    alert.routes.ts
    alert.controller.ts
    alert.service.ts
    alert.validation.ts
  modules/README.md
  services/database.ts
  utils/
    HttpResponse.ts
    HttpError.ts
    token.ts
  app.ts
  server.ts
  index.ts
tests/{foundation,auth,auth-client,workspaces-projects,agents,events,detections}.test.ts
.env.example
```

- `config/env.ts`: loads a package-local ignored `.env`, validates configuration
  with Zod, reports invalid field names without showing credentials, and exports
  the shared access/refresh cookie configuration.
- `services/database.ts`: initializes one pool/Drizzle client from the existing
  database package and implements readiness using a real `SELECT 1`.
- `app.ts`: installs Helmet, configured CORS, JSON/form parsers, health routes,
  JSON 404 handling, and the global error handler.
- `server.ts`: creates the Node HTTP server, attaches Socket.IO, listens, and
  closes HTTP/Socket.IO and the pool on SIGINT/SIGTERM. Shutdown is bounded to
  ten seconds. It does not create tables or run migrations.
- `index.ts`: compatibility entry point that imports `server.ts`; normal scripts
  use `server.ts` directly.
- `HttpResponse.ts`: consistent `{ success, statusCode, message, data? }` successes.
- `HttpError.ts`: intentional public HTTP errors with optional safe details.
- `globalErrorHandler.ts`: formats HttpError/Zod/parser failures and hides
  unexpected error messages and all stack traces.
- `requestLogger.ts`: console logging of method, path, status and duration.
  It does not log query strings, request bodies, headers or credentials.
- `modules/`: future feature modules are added when needed, not as empty folders.
  Keep routes, controllers, services and Zod validation separate.
  Auth uses direct named controller/service exports with explicit try/catch and
  `next(error)`. Database queries live in `auth.repo.ts`; token generation,
  signing, and verification live in `utils/token.ts`. There are no
  controller/service/router factories.

## Configuration

`DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` are required.
The two signing secrets must be different, random values of at least 32 bytes
(configuration enforces at least 32 characters). `PORT` defaults to 4000, `HOST` to `0.0.0.0`,
`NODE_ENV` to `development`, and `CORS_ORIGINS` to `http://localhost:3000`.
Multiple origins are comma-separated. Configure the actual frontend origin
before cross-origin browser use. CORS credentials are enabled for the configured
origins, without a wildcard. The Node server trusts one reverse-proxy hop; adjust
`trust proxy` for your own deployment topology.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access JWT lifetime (60–3600 seconds) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Refresh JWT lifetime (1 hour–30 days); must exceed access lifetime |
| `COOKIE_SECURE` | true in production, false otherwise | HTTPS-only cookies; production cannot disable it |
| `COOKIE_SAME_SITE` | `lax` | `lax`, `strict`, or `none`; `none` requires Secure |
| `COOKIE_DOMAIN` | omitted | Host-only cookies by default; set only when sharing across subdomains |

For a genuinely cross-site frontend/API deployment, use HTTPS,
`COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and the explicit frontend origin
in `CORS_ORIGINS`. Browsers can still block third-party cookies. Prefer same-site
frontend/API hosting when possible.

See `.env.example` for variable names; never commit real credentials.

## Run

From the repository root:

```sh
pnpm exec turbo run dev --filter=@workspace/netsleuth-api
pnpm exec turbo run build --filter=@workspace/netsleuth-api...
pnpm --filter @workspace/netsleuth-api start
pnpm --filter @workspace/netsleuth-api typecheck
pnpm --filter @workspace/netsleuth-api test
```

The configured Replit API workflow now runs this application through Turbo,
instead of the retained starter server. Turbo builds shared package dependencies
before development. Direct package `dev` assumes dependencies were built already.

The API remains alive if PostgreSQL is temporarily unreachable: liveness answers
200, while readiness checks the connection and answers 503. Pool connection and
query/statement timeouts are three seconds. Readiness proves reachability only,
not that application migrations are installed.

## Endpoints

- `GET /health` → 200, API is running.
- `GET /health/ready` → 200 if PostgreSQL responds, otherwise 503.
- `/api/health` and `/api/health/ready` are aliases for path-prefixed clients.
- `GET /api/healthz` retains the starter's `{ "status": "ok" }` response solely for
  compatibility; new endpoints use the standard envelope.
- Unknown API paths → JSON 404.
- `/socket.io/` supports the basic Engine.IO/Socket.IO handshake. There are no
  authentication, subscription, broadcast, or monitoring-event handlers.

Success:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "API is ready",
  "data": { "database": "connected" }
}
```

Error:

```json
{
  "success": false,
  "statusCode": 503,
  "message": "Database is unavailable"
}
```

OpenAPI remains in `lib/api-spec/openapi.yaml` with the existing `/api` base.
Regenerate clients/validators using
`pnpm --filter @workspace/api-spec codegen` after changing contracts.
Generic response types live in `@workspace/netsleuth-shared`.

## Verification

Unit tests exercise successes, failed readiness, JSON/parser limits, 404,
HttpError, Zod failures, unexpected-error redaction, headers and route aliases.
Database checks in unit tests are explicit test doubles, not real observations.
The running server's readiness endpoint must be checked separately to verify
the actual PostgreSQL connection.

Authentication tests use real bcrypt, JWT verification, and PostgreSQL in a
random temporary schema inside a rolled-back transaction. They do not create
accounts in the application's public tables. They check registration,
case-insensitive duplicate rejection, invalid input, password verification,
cookie-only access, token expiry/type checks, stateless refresh, cookie clearing,
and deleted users. A middleware test confirms no database query is required.
The frontend transport test verifies that requests send cookies directly,
without CSRF preflight requests or Authorization headers.

## Cookie authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Register and set access/refresh cookies |
| POST | `/api/v1/auth/login` | Verify credentials and set cookies |
| POST | `/api/v1/auth/refresh` | Verify refresh JWT and set new JWT cookies |
| POST | `/api/v1/auth/logout` | Clear browser cookies |
| GET | `/api/v1/auth/me` | Return safe user fields from PostgreSQL |

JWTs are **never returned in JSON or read from Authorization headers**.
`netsleuth_access` is an HTTP-only cookie at `/`; `netsleuth_refresh` is an
HTTP-only cookie at `/api/v1/auth`. Both use the configured SameSite/Secure/domain
options. Clearing cookies uses the same options and paths.

Authentication is stateless. Register/login set JWT cookies; middleware verifies
the access JWT signature and expiration and attaches `req.userId`. Only `/me`
and refresh look up the current user. No session records are created or queried.
The old `refresh_sessions` schema/table is retained but unused; this change
does not delete existing database data or rewrite migration history.

Logout only clears cookies. Copied access/refresh JWTs remain usable until they
expire; issuing a new refresh JWT does not invalidate the previous one. There
is no server-side revocation, replay detection, or absolute session limit.
CSRF middleware, tokens, and the `/csrf` endpoint have been removed at the user's
request. SameSite/Secure cookies and restricted CORS remain, but are not a
complete replacement for CSRF protection, particularly with SameSite=None.

`lib/api-client-react/src/custom-fetch.ts` always uses `credentials: "include"`,
and does not send Authorization. Writes go directly to their endpoint.
No browser local/session storage is used for tokens. Automatic retries/refresh
and frontend sign-in screens are not part of this backend module.

### Example browser request

```ts
const response = await fetch("/api/v1/auth/register", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Example User",
    email: "example@example.invalid",
    password: "replace-with-a-strong-password",
  }),
});
const result = await response.json();
```

Example registration response (HTTP 201):

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Registration successful",
  "data": {
    "user": {
      "id": "09f6cda0-21f2-4b41-9ee4-8f9e253a7db0",
      "name": "Example User",
      "email": "example@example.invalid",
      "createdAt": "2026-11-09T10:00:00.000Z",
      "updatedAt": "2026-11-09T10:00:00.000Z"
    }
  }
}
```

Missing access cookies return HTTP 401 with the existing error envelope:

```json
{
  "success": false,
  "statusCode": 401,
  "message": "Access cookie is required"
}
```

Login/registration share a process-local limit of 30 attempts per IP per
15 minutes. A shared rate-limit store is needed before horizontal scaling.
No password recovery or email verification is implemented.

## Workspace and project management

All six endpoints use the existing access-cookie middleware:

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/v1/workspaces` | Authenticated user; becomes OWNER |
| GET | `/api/v1/workspaces` | Lists only the user's memberships |
| GET | `/api/v1/workspaces/:workspaceId` | Workspace member |
| POST | `/api/v1/workspaces/:workspaceId/projects` | Workspace OWNER or ADMIN |
| GET | `/api/v1/workspaces/:workspaceId/projects` | Workspace member |
| GET | `/api/v1/projects/:projectId` | Member of the project's actual workspace |

Workspace creation accepts `{ "name": "My workspace" }`. Project creation
accepts `{ "name": "My project", "description": "Optional description" }`.
Names are trimmed and must contain 1–100 characters. Descriptions are trimmed
and limited to 2000 characters; omitting one stores `null`. Unknown body fields
are rejected, so callers cannot override ownership, roles, or workspace IDs.

Success data uses `{ workspace }`, `{ workspaces }`, `{ project }`, or
`{ projects }` inside the existing HttpResponse envelope. Creation returns 201;
reads return 200. Missing access cookies return 401, invalid inputs/UUIDs return
400, and ordinary members attempting project creation receive 403. Inaccessible
and missing workspaces/projects both return 404 to avoid revealing their existence.

`workspace.service.ts` exports the reusable `requireWorkspaceMember` helper.
It reads current membership/roles from PostgreSQL rather than trusting JWT roles
or client-supplied IDs. Project reads also join workspace membership directly.
Workspace and OWNER membership creation share one database transaction, so a
failed membership insertion cannot leave an orphan workspace.

The authorization integration tests use a temporary PostgreSQL schema and roll
back all fixtures. They cover all six protected endpoints, OWNER/ADMIN/MEMBER
permissions, role changes, removed memberships, cross-workspace UUID attempts,
validation, and transaction rollback without exposing internal database errors.
No schema changes or new environment variables are required. This module does
not add member-management endpoints, ingestion,
detections, or alerts, and does not change cookie authentication.

## Agent registration and credentials

Management uses the existing user access cookie, never an agent key:

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/v1/projects/:projectId/agents` | Any member of the project's workspace |
| GET | `/api/v1/projects/:projectId/agents` | Any member; up to 100 newest agents |
| GET | `/api/v1/agents/:agentId` | Member of the agent's actual workspace |
| POST | `/api/v1/agents/:agentId/revoke` | Member of the agent's actual workspace |

Registration accepts `{ "name": "My sensor" }`. Names are trimmed, 1–100
characters; unknown fields are rejected. The server derives ownership from the
authorized project, not body fields. It returns 201 with
`data: { agent, apiKey }` and `Cache-Control: no-store`. Copy the key into the
agent's secure configuration immediately: it is returned only in that response.
Reads/revocation return 200 with `{ agents }` or `{ agent }` inside `data`,
never keys or hashes. Revoked agents remain visible for management.
Missing user cookies return 401, invalid inputs return 400, and inaccessible or
missing projects/agents return 404 without revealing cross-workspace existence.

Keys contain 32 cryptographically random bytes (256 bits), encoded as
`ns_agent_` followed by 64 lowercase hex characters. Only the SHA-256 digest is
stored in the unique `agents.api_key_hash` column. Fast SHA-256 is appropriate
for random high-entropy keys; user passwords still use bcrypt.
The nullable `revoked_at` timestamp records revocation. Migration
`packages/database/drizzle/0002_absurd_terrax.sql` adds both columns and the
unique constraint without changing existing data. Older agents have a NULL
hash and cannot authenticate; this phase does not add a reissue/rotation endpoint.

`agentAuthMiddleware` reads **only `X-Agent-Key`**, queries the current database
row by hash with `revokedAt IS NULL`, and attaches `req.agentId` and
`req.projectId` from that row. Cookies, user JWTs, Authorization headers, and
client-supplied project IDs never establish agent identity. No credential cache
is used, so authentication attempts after a completed revocation fail immediately.
Already-running requests are not cancelled. Revoking sets status to INACTIVE;
repeating revocation returns the already-revoked agent.

The ingestion endpoint below uses this middleware, separately from the
user-authenticated management routes. Agent integration tests also mount a
test-only probe and exercise the real middleware against PostgreSQL. They cover successful registration, hash-only
storage, unique keys, project binding, strict validation, read/revoke authorization,
revocation, deletion, removed memberships, rejection of JWTs/cookies/invalid keys,
and non-disclosure in responses and request logs. All fixtures roll back.
No new secrets, packages, or environment variables are required.

## Network event ingestion

**`POST /api/v1/ingest/events`**

Send `Content-Type: application/json` and `X-Agent-Key` with the key returned at
agent registration. User cookies and Authorization headers cannot authenticate
this endpoint. Use HTTPS outside local development. The body is either one event
object or a raw array of **1–100 events**, not an `{ events: [...] }` wrapper.
The existing 1 MiB request limit still applies.

Reusable schemas and inferred types live in
`packages/shared/src/events.ts` and are exported by `@workspace/netsleuth-shared`
for both API and agent use. `event.validation.ts` reuses that schema rather than
defining a second validation implementation.

| Field | Validation |
| --- | --- |
| eventId | Required agent-generated UUID; lowercase normalization for deduplication |
| eventType | One of the six values below |
| sourceIp, destinationIp | Required IPv4 or IPv6 address; CIDR ranges rejected |
| sourcePort, destinationPort | Optional integer 0–65535; omitted fields store NULL |
| protocol | TCP, UDP, or OTHER |
| metadata | Optional JSON object; omitted field stores `{}` |
| occurredAt | Required ISO 8601 timestamp with `Z` or timezone offset |

Supported event types:
`NETWORK_CONNECTION_ATTEMPT`, `NETWORK_CONNECTION_ESTABLISHED`,
`AUTHENTICATION_FAILURE`, `AUTHENTICATION_SUCCESS`, `SERVICE_DISCOVERED`,
and `AGENT_HEARTBEAT`.

Unknown top-level fields, including `agentId`, `projectId`, and raw payload
fields, are rejected. Metadata is for structured context only; clients must not
put raw packets, packet payloads, credentials, or secrets in it. Metadata never
determines ownership. The API does not capture packets or generate events.

Example request body:

```json
{
  "eventId": "15b0f9d0-72c8-4da0-8d7c-9278ae612bbe",
  "eventType": "NETWORK_CONNECTION_ATTEMPT",
  "sourceIp": "192.0.2.10",
  "sourcePort": 45123,
  "destinationIp": "198.51.100.20",
  "destinationPort": 443,
  "protocol": "TCP",
  "metadata": { "service": "https" },
  "occurredAt": "2026-11-09T07:00:00Z"
}
```

Successful response, only after the transaction commits (HTTP 200):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Events ingested successfully",
  "data": { "insertedCount": 1, "duplicateCount": 0 }
}
```

Retrying the same event returns `{ "insertedCount": 0, "duplicateCount": 1 }`
inside `data`. The existing `(agentId, eventId)` unique constraint is used with
`ON CONFLICT DO NOTHING`, including duplicates within one batch. For duplicate
IDs, the first persisted event wins; retries do not overwrite its contents.
Different agents may use the same event UUID. No schema migration is needed.

The whole input is validated before any write. One database transaction locks
and rechecks the middleware-resolved agent/project and revocation state, inserts
events, and, for newly inserted heartbeats, sets only that agent to ONLINE with
`lastHeartbeatAt` from the server clock. Retried heartbeats do not advance it.
The lock serializes writes with revocation; no process-local credential cache
can bypass the current database state. If any write fails, all inserts and the
heartbeat update roll back, and the response is not successful.

Errors use the existing global handler: 400 invalid input/JSON, 401
missing/invalid/revoked agent key, 413 oversized body, or sanitized 500 for an
unexpected database failure. After this ingestion transaction commits, the
detection service below evaluates only newly inserted event IDs. There are no
Redis/Kafka services, queues, collectors, or frontend changes.

Integration tests use the real endpoint, middleware, and PostgreSQL in an
isolated, rolled-back schema. They check single/batch persistence, supported
types, malformed data, full-batch rejection, size bounds, duplicate counts,
UUID casing, agent isolation, heartbeat/retry behavior, revoked credentials,
and rollback after a forced database heartbeat failure. Run:
`pnpm --filter @workspace/netsleuth-api test`.

## Initial detection engine

`modules/detections/detection.service.ts` is called directly by ingestion after
the event/heartbeat transaction commits. It loads the actual persisted rows by
their new IDs, joined to agents in the specified project. Duplicate ingestion
does not trigger detection. Detection has its own transaction and locks the
project row to serialize alert generation and policy changes within a project.

### Repeated authentication failures

`AUTH_FAILURE_THRESHOLD = 5` and `AUTH_FAILURE_WINDOW_SECONDS = 60` are exported
configuration constants at the top of the detection service.
Only `AUTHENTICATION_FAILURE` counts. The same source/destination pair within
one project must have at least five failures in an inclusive rolling 60-second
window of **occurredAt**, not receipt time. Multiple agents in the same project
can contribute; different projects, source IPs, or destination IPs cannot.
The sliding window handles late/out-of-order events and does not use fixed
minute buckets.

The HIGH alert contains source/destination IPs, failure count, threshold, window
duration/bounds, agent-provided event IDs, and persisted event/agent IDs and
timestamps. It describes reported failures, not proof of an attack.

### Unexpected database destinations

One nullable JSONB column, `projects.database_policy`, is added by
`packages/database/drizzle/0003_misty_adam_warlock.sql`. Existing projects default
to NULL; no database destination or monitored port is hardcoded.

These endpoints use user access cookies:

| Method | Endpoint | Permission |
| --- | --- | --- |
| GET | `/api/v1/projects/:projectId/database-policy` | Workspace member |
| PUT | `/api/v1/projects/:projectId/database-policy` | Workspace OWNER or ADMIN |

PUT replaces the complete configuration:

```json
{
  "databasePolicy": {
    "databasePorts": [5432, 3306],
    "allowedDestinations": [
      { "ip": "198.51.100.20", "port": 5432, "protocol": "TCP" }
    ]
  }
}
```

The monitored port list has 1–32 entries (1–65535); the allowlist has at most
100 exact IP/port/TCP-or-UDP tuples. Allowed ports must appear in databasePorts.
Equivalent IPv6 forms are normalized. Hostnames, CIDR ranges, and wildcard
destinations are not supported. An empty allowlist permits no destinations on
the monitored ports. `{ "databasePolicy": null }` disables Rule B.
NULL is not equivalent to an empty allowlist: without a policy the engine
cannot identify project-specific database ports and does not evaluate Rule B.

Only `NETWORK_CONNECTION_ATTEMPT` and `NETWORK_CONNECTION_ESTABLISHED` events
with a destination port and TCP/UDP protocol are evaluated, and only for a
monitored database port. A destination outside the exact allowlist generates a
MEDIUM alert with destination IP/port/protocol, source IP, event ID/type,
connection-attempt versus established observation, and a policy snapshot.
An attempt does not prove a successful database login; a monitored port alone
does not prove which database software is running.

### Alert deduplication and listing

The existing `(projectId, fingerprint)` uniqueness constraint is reused.
Fingerprints include rule and subject identity; no event ID is included in an
equivalent-observation fingerprint. Authentication alerts group a source/
destination pair; database alerts additionally identify the observing agent,
destination port, and protocol.
OPEN and ACKNOWLEDGED alerts update evidence and lastSeenAt in place.
firstSeenAt is never overwritten, and older observations cannot regress
lastSeenAt or newer evidence. RESOLVED alerts remain unchanged; this MVP does
not automatically reopen them or create new incidents for the same fingerprint.
No acknowledge/resolve API is added here.

**GET `/api/v1/projects/:projectId/alerts?page=1&limit=20&severity=HIGH&status=OPEN`**

Requires a user access cookie and current membership in the project's actual
workspace. Agent keys cannot authenticate this endpoint. Unknown/inaccessible
projects return 404 without revealing existence. Optional severity values are
LOW/MEDIUM/HIGH/CRITICAL; status values are OPEN/ACKNOWLEDGED/RESOLVED.
Page defaults to 1 (maximum 100000) and limit to 20 (maximum 100). Invalid inputs
return 400. Results are sorted by lastSeenAt descending with an ID tie-breaker.
The existing database alert-read helper is extended with validated filters and
offset/limit, retaining its bounded, workspace/project-scoped default behavior.

Success data:

```json
{
  "alerts": [],
  "pagination": { "page": 1, "limit": 20, "hasMore": false }
}
```

As with other successful endpoints this sits inside the HttpResponse envelope.
There is no new dashboard UI, ML, automatic blocking, or remediation.

### Failure boundary and tests

Ingestion and detection are deliberately separate transactions: detection only
sees successfully persisted events. A detection failure returns a sanitized 500,
but the events/heartbeat remain committed. A duplicate-only retry does not
reprocess them. There is no durable detection backlog/recovery endpoint yet;
the internal idempotent detection service can safely reprocess persisted IDs,
but an authorized operational recovery flow is future work.

Real PostgreSQL integration tests cover the four/five failure threshold,
different sources/destinations/projects, time boundaries, late arrivals,
multi-agent evidence, non-authentication events, policy permissions,
allowlisted/unconfigured destinations, missing destination information,
IPv6 normalization, duplicate ingestion, detection reprocessing, preserved
firstSeenAt/monotonic lastSeenAt, resolved behavior, pagination/filtering,
cross-workspace denial, and explicit failure after event persistence.
Fixtures, temporary triggers, and schemas are rolled back; no real monitoring
activity is manufactured.
