# NetSleuth

An open-source, self-hostable security observability platform. The API supports
cookie authentication, workspace/project isolation, agent credentials, event
ingestion, and two initial detection rules. A standalone Linux agent collects
TCP/UDP socket metadata. The Next.js frontend provides cookie-authenticated
navigation, workspace/project selection, and a persisted-data overview with
project counts, activity, alerts and agent health. Agent management includes
registration with one-time setup credentials, details, and confirmed revocation.
The Network Events Explorer adds server-side filtering/pagination and scoped
event details. Alert investigation remains deferred.
See [event exploration](docs/events-explorer.md) for filters and API boundaries.
See [agent management](docs/agent-management.md) for its API and setup boundaries.
See [the database package](packages/database/README.md) for the complete schema,
migrations, connection setup, and security boundaries.
See [the API package](apps/api/README.md) for backend structure and health routes.

## Requirements and installation

- Node.js 22 or newer
- PostgreSQL 14+ (local service or an existing development database).
- Linux with iproute2/`ss` for actual collection and `pnpm test:e2e`.
- pnpm 10.26.1 (`corepack enable && corepack prepare pnpm@10.26.1 --activate`
  if your Node installation includes Corepack; otherwise install pnpm separately)

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo ls
pnpm run lint
pnpm run typecheck
pnpm run build
```

Typechecking/builds do not require a database connection. Running the API requires
`DATABASE_URL` and separate JWT signing secrets; packet capture and Docker are
not required.

## Environment configuration

Use the package `.env.example` files as templates. Keep actual values in a
secret manager or ignored package-local `.env` files, never in Git.

| Component | Configuration |
| --- | --- |
| API (`apps/api/.env`) | Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Secrets must be different and at least 32 characters. |
| API runtime | `PORT=4000`, `HOST=0.0.0.0`, `NODE_ENV=development`, `CORS_ORIGINS=http://localhost:3000` by default. |
| Browser cookies | `JWT_ACCESS_TTL_SECONDS=900`, `JWT_REFRESH_TTL_SECONDS=604800`, `COOKIE_SAME_SITE=lax`. `COOKIE_SECURE` defaults on in production; `COOKIE_DOMAIN` is optional. Production and SameSite=None require secure cookies. |
| Database CLI (`packages/database/.env`) | `DATABASE_URL` for development/local migration commands. Existing process variables take precedence. |
| Frontend (`apps/web/.env.local`) | Optional server-only `NETSLEUTH_API_URL` selects the API origin for local Next.js rewrites (default `http://127.0.0.1:4000`). Browser requests use same-origin `/api/v1` with credentials. Optional process `PORT` selects the listening port (default 3000). Never put server secrets in `NEXT_PUBLIC_*` variables. |
| Agent (`apps/agent/.env`) | Required: `NETSLEUTH_API_URL` (base origin), `NETSLEUTH_AGENT_KEY` (issued by registration). Defaults: `COLLECTION_INTERVAL_MS=10000`, `HEARTBEAT_INTERVAL_MS=30000`. Production requires HTTPS. |

Browser clients must retain HTTP-only cookies and use `credentials: "include"`.
They must not use Bearer tokens. Agent requests use `X-Agent-Key` only, never
browser cookies. The one-time agent registration response intentionally returns
its new key; later reads never return the key or its hash.

## PostgreSQL and migrations

The repository has no `db:start` script or bundled Docker/Compose setup.
Start PostgreSQL using your installed service or your existing local cluster
before running database commands. For an **already initialized local cluster**
owned by your OS user, an example is:

```sh
pg_ctl -D /path/to/your/local/pgdata -l /path/to/your/local/postgres.log start
createdb -h 127.0.0.1 -U "$(id -un)" netsleuth
```

Choose the correct database role for your installation; inherited PostgreSQL
client settings can otherwise select a different role. These are host PostgreSQL
utilities, not pnpm scripts. An existing managed database needs no local server.
Supply its connection URL securely instead.

For a **fresh, empty development database**, after setting `DATABASE_URL`:

```sh
pnpm --filter @workspace/netsleuth-database db:migrate
```

All four checked-in migrations were verified using this command against a fresh
temporary PostgreSQL cluster. Do not run `db:generate` just to start the app;
that command is for deliberate schema changes.

**Existing databases:** an empty Drizzle journal does not prove the schema is
empty. This workspace's development tables predate its migration journal.
Do not replay initial migrations, drop tables, or blindly stamp the journal.
Inspect and apply only reviewed missing changes; see
[database migration guidance](packages/database/README.md). API startup, tests,
and builds do not migrate application tables. Development instructions are not
production migration hooks.

## Run each application

Run web and API in separate terminals:

```sh
# Next.js, default port 3000; optionally set PORT
pnpm --filter @workspace/netsleuth-web dev

# Express, default port 4000; requires DATABASE_URL
pnpm exec turbo run dev --filter=@workspace/netsleuth-api

# Standalone Linux agent; requires ss and configured API URL/agent key
pnpm --filter @workspace/netsleuth-agent start
```

The agent's `start` command requires a build first and starts socket-table
polling and heartbeat reporting. Its `dev` command uses `tsx watch` to rerun
the TypeScript source after edits. See [agent setup](apps/agent/README.md) for
secure configuration and Linux visibility limitations.
After building, use `start` instead of `dev` for web and API to run compiled output.
The API exposes liveness at `/health` and a real PostgreSQL check at
`/health/ready`. Neither endpoint claims that ingestion or detection works.
The agent is independent and is not started by the API workflow.

For ordinary local development, `pnpm dev` starts web/API only. Start the agent
separately after registration and configuration; it is intentionally excluded
so missing agent credentials do not stop web/API development. Do not share one
explicit `PORT` value between both servers.

These are portable local-development commands. The Replit API workflow now points
at `apps/api` through Turbo. Existing `artifacts/`, `lib/`, and `scripts/` retain
starter source/tooling; the component preview workflow remains unchanged.

## Turborepo orchestration

- `pnpm build`: builds the five NetSleuth code workspaces, with dependency builds
  first. `packages/config` contains only configuration and requires no compilation.
- `pnpm typecheck`: compiles the retained starter library declarations first,
  then runs every available workspace typecheck through Turbo.
- `pnpm lint`: runs ESLint across all six NetSleuth workspaces.
- `pnpm test`: invokes available workspace test scripts through Turbo, including
  backend and agent checks. Test execution is uncached because it depends on
  live PostgreSQL and runtime behavior.
- `pnpm test:e2e`: builds API/agent prerequisites and runs the explicit Linux
  HTTP/agent/PostgreSQL integration test.
- `pnpm dev`: local-only web/API orchestration; not a Replit preview workflow.
- `pnpm typecheck:netsleuth`: checks only NetSleuth, building dependencies first.
- `pnpm build:netsleuth`: compatibility alias for `pnpm build`.
- `pnpm exec turbo ls`: lists all 13 discovered packages (six NetSleuth and seven
  preserved starter packages; pnpm also counts the root as a fourteenth project).

Builds are cached in `.turbo/`; emitted `dist/` and Next.js outputs can be restored
from cache. Development is persistent and uncached. Test outputs, when tests are
added, belong in `coverage/`. Shared config edits invalidate dependent tasks
through their `workspace:*` relationships. Build and typecheck tasks build
dependency packages before resolving their emitted entry points.

`PORT` and `HOST` pass through to runtime tasks; future environment-dependent
build inputs must be declared in `turbo.json` before use. Runtime secrets are
required by the API/agent but must never be committed. Remote caching is not configured.

The NetSleuth package graph is intentionally one-way:

```text
web   -> shared
api   -> shared, database
agent -> shared
all five code workspaces -> config (development dependency only)
```

All arrows are explicit `workspace:*` links. Shared response interfaces and
reusable event Zod schemas/types live in the shared package.
The database package owns the schema, client, and workspace-scoped read helpers.
The agent has no dependency on the API, frontend, or database package.
To build the agent and only its prerequisites:

```sh
pnpm exec turbo run build --filter=@workspace/netsleuth-agent...
```

Package names retain the existing `@workspace/netsleuth-*` convention to avoid
unnecessary renaming. `packages/config/base.json` is the source of strict
TypeScript settings. `tsconfig.netsleuth.json` remains a compatibility wrapper,
not a second set of settings. Root `tsconfig.json` remains the working starter
library solution. The shared ESLint flat config uses the recommended JavaScript
and TypeScript rules; framework-specific linting can be added when UI exists.

## New file structure

```text
apps/
  web/
    package.json
    tsconfig.json
    next-env.d.ts
    next.config.ts
    postcss.config.mjs
    components.json
    src/
      app/
        globals.css
        layout.tsx
        page.tsx
      lib/utils.ts
  api/
    package.json
    tsconfig.json
    src/
      app.ts
      index.ts
  agent/
    package.json
    tsconfig.json
    src/index.ts
packages/
  config/
    package.json
    base.json
    eslint.config.mjs
  database/
    package.json
    tsconfig.json
    src/index.ts
  shared/
    package.json
    tsconfig.json
    src/index.ts
infrastructure/
  README.md
README.md
turbo.json
tsconfig.netsleuth.json
```

Root configuration also includes `package.json`, `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, `tsconfig.json`, `.gitignore`, and `replit.md`.
Next.js generates `.next/` and may update its
generated `next-env.d.ts` during builds. Compiled files are ignored.

## Intended communication and boundaries

```text
Browser HTTP client ── cookie-authenticated REST ──> API ── Drizzle ──> PostgreSQL
Linux agent ── X-Agent-Key / HTTP event ingestion ──> API ── detection ──> alerts
Next.js frontend ── same-origin /api/v1, HTTP-only cookies ──> API
```

The API implements REST authentication, workspace/project management, agent
credentials, and event ingestion/persistence. The standalone Linux agent polls
TCP/UDP socket metadata with ss, publishes new observations, and sends periodic
heartbeats when configured. Socket.IO has a basic server handshake
but no authenticated subscriptions or application events. Shared Zod event
contracts and response interfaces live in `packages/shared`.
The database package implements Drizzle/PostgreSQL schema and migration tooling.
Importing it has no connection side effects; call `createDatabase()` to initialize
a client with `DATABASE_URL`. `lib/db` delegates to it for starter compatibility.

The API's `createApp` function wires routes and middleware. Keep feature modules
simple: routes, thin controllers, services, and validation, with repository
functions where needed. Do not add empty feature implementations just to imply
those systems already exist.

The production agent must never import API internals or database repositories.
It depends only on shared contracts and its own collection/transport code.
The web application must never import server-only database code.

Tailwind CSS and shadcn/ui configuration are reused by the dashboard foundation.
The frontend has shared auth/dashboard providers, layout and UI components;
see [the web application](apps/web/README.md) for routes and integration details.

## Architectural risks to resolve in later stages

- **Ingestion pressure:** requests are limited to 100 events/1 MiB and use
  per-agent idempotency. Define backpressure and retention before handling
  high-volume security events; no background queue exists yet.
- **Identity and trust:** user cookie and agent-key authentication are implemented;
  authorize Socket.IO subscriptions and protect secrets. Ingested events are
  validated using the shared contract.
- **Contract evolution:** version event contracts so independently deployed
  agents can tolerate control-plane upgrades.
- **Capture visibility:** the current collector polls Linux socket tables with
  ss. Short-lived connections can be missed; it is not full packet-level
  visibility. Permissions and network namespaces restrict observations. Validate
  actual host-level visibility on Linux; Docker Desktop does not automatically
  expose the macOS/Windows host's traffic.
- **Sensitive observations:** packet metadata and PostgreSQL logs may contain
  sensitive information; plan redaction, encryption, and access restrictions.
- **Realtime deployment:** decide reverse-proxy WebSocket paths and multi-instance
  Socket.IO coordination before enabling live updates.
- **Portability:** keep capture platform assumptions explicit and infrastructure
  configuration separate from application code.

Workspace/project creation and member-authorized reads are implemented; see
`apps/api/README.md` for endpoints and permissions.
Agent registration, project-scoped listing/details, credential revocation, and
separate `X-Agent-Key` authentication middleware are also implemented.
`POST /api/v1/ingest/events` accepts a single event or batch, persists validated
events with duplicate counts, and updates agent heartbeat state atomically.
It then calls the initial detection service for committed new events. Repeated
authentication failures and database destinations outside project allowlists
generate deduplicated alerts. Project policy configuration and a paginated,
member-authorized alerts endpoint are available; see `apps/api/README.md`.

Additional detection rules, PostgreSQL log
collection, packet capture, additional monitoring dashboard features, Dockerfiles, and Compose are deferred.
No simulated events are presented as real observations.

## Register an agent and exercise the API

Use an HTTP client with a cookie jar for user requests. The JSON envelope is
`{ success, statusCode, message, data? }`; IDs come from the preceding responses.

| Step | Request | Body / result |
| --- | --- | --- |
| Register | `POST /api/v1/auth/register` | `name`, `email`, `password`; sets HTTP-only access/refresh cookies. |
| Login | `POST /api/v1/auth/login` | `email`, `password`; retains cookies for subsequent user requests. |
| Create workspace | `POST /api/v1/workspaces` | `{ "name": "Local lab" }`; take `data.workspace.id`. |
| Create project | `POST /api/v1/workspaces/:workspaceId/projects` | `{ "name": "Monitored host" }`; take `data.project.id`. |
| Register agent | `POST /api/v1/projects/:projectId/agents` | `{ "name": "Linux host" }`; securely retain the one-time `data.apiKey`. |
| Configure detection | `PUT /api/v1/projects/:projectId/database-policy` | Example below. Requires owner/admin membership. |
| Start agent | `pnpm --filter @workspace/netsleuth-agent start` | Configure its ignored `.env` first; build first as shown above. |
| Retrieve alerts | `GET /api/v1/projects/:projectId/alerts?severity=MEDIUM&status=OPEN&page=1&limit=20` | Cookie-authenticated, project-scoped results. |
| Revoke | `POST /api/v1/agents/:agentId/revoke` | Cookie-authenticated; subsequent key-based ingestion returns 401. |

Example **lab-only** policy:

```json
{
  "databasePolicy": {
    "databasePorts": [5432],
    "allowedDestinations": [
      { "ip": "127.0.0.1", "port": 5432, "protocol": "TCP" }
    ]
  }
}
```

Only connection events to configured monitored ports are evaluated by this rule.
An exact allowed IP/port/protocol tuple does not alert. Other destinations on
those ports can produce a MEDIUM alert; a connection attempt is not evidence
of a successful database login.

The agent appends `/api/v1/ingest/events` to `NETSLEUTH_API_URL`, sends raw event
objects/arrays (not `{ events: [...] }`), and takes identity/project scope from
its verified key. Maximum batch: 100 events/1 MiB. Event UUID retries use the
existing per-agent uniqueness constraint and return inserted/duplicate counts.

## Automated event-to-alert verification

After configuring the API database and signing secrets:

```sh
pnpm test                         # API + collector/publisher tests
pnpm test:e2e                     # Linux + ss + real PostgreSQL required
pnpm lint
pnpm typecheck
pnpm build

# Optional constraint/scoped-query suite: explicitly provide a disposable
# TEST_DATABASE_URL securely in this process first.
pnpm --filter @workspace/netsleuth-database test:db
```

`test:e2e` exercises real registration/login cookies, workspace/project creation,
agent registration, the running Linux collector with a controlled TCP socket,
HTTP publishing, persisted events/heartbeats, both detection rules, duplicate
handling/evidence preservation, scoped alert retrieval, isolation, and revocation.
It uses a unique schema inside one transaction and rolls it back, including
test migrations; no application rows or migration history are committed.
The role needs schema-creation permission. Missing prerequisites fail explicitly.

Authentication-failure fixtures are deliberately synthetic and separate from
socket observations: four failures do not alert, five qualifying failures from
one source/destination pair within 60 seconds produce HIGH severity, and different
sources are not combined. The collector does **not** infer authentication outcomes.

See [verification results and remaining gaps](docs/integration-report.md).

## Current limitations

- The overview has aggregate metrics and bounded read-only lists, not a full
  event explorer, agent manager, or alert investigator. Workspace/project
  creation still uses the existing API. See [overview semantics](docs/dashboard-overview.md).
- Socket.IO has no authenticated project subscriptions or application events.
- Polling can miss transient sockets; observed direction can be unknown.
  UDP association is not a handshake, and bound sockets do not prove a service.
- No authentication-log ingestion; actual login outcomes require another
  trustworthy evidence source.
- Agent retries are bounded and there is no durable offline buffer. Events can
  be lost after retry exhaustion.
- Ingestion commits before detection. A detector failure can persist an event
  without its alert; duplicate retries do not rerun detection. No recovery queue
  or replay endpoint is implemented.
- Resolved alerts are not automatically reopened, and no alert state-change API
  is implemented yet.
- Heartbeats set ONLINE; no scheduler automatically marks stale agents OFFLINE.
- Authentication remains stateless by request: logout clears cookies but does
  not revoke already copied JWTs. CSRF protection and server-side refresh-session
  tracking remain intentionally absent.
