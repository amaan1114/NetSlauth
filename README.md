# NetSleuth

Foundation for an open-source, self-hostable security observability platform.
The monorepo and database layer are implemented; security monitoring is not.
See [the database package](packages/database/README.md) for the complete schema,
migrations, connection setup, and security boundaries.

## Requirements and installation

- Node.js 22 or newer
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

No database, credentials, tcpdump, or Docker installation is needed for this stage.

## Run each application

Run web and API in separate terminals:

```sh
# Next.js, default port 3000; optionally set PORT
pnpm --filter @workspace/netsleuth-web dev

# Express, default port 4000; optionally set PORT and HOST
pnpm --filter @workspace/netsleuth-api dev

# Standalone agent entry point; prints its unimplemented status and exits
pnpm --filter @workspace/netsleuth-agent start
```

The agent's `start` command requires a build first. Its `dev` command uses
`tsx watch` to rerun the entry point after edits; it does not start collection.
After building, use `start` instead of `dev` for web and API to run compiled output.
The API exposes only `GET /health`. A successful health response means the process
is reachable, **not** that ingestion, detection, or database connectivity works.
The agent does not run a background collector.

These commands are portable local-development commands, not configured Replit
preview services. Existing `artifacts/`, `lib/`, and `scripts/` are retained starter
packages and are not the NetSleuth applications. Existing preview workflows still
run those starters.

## Turborepo orchestration

- `pnpm build`: builds the five NetSleuth code workspaces, with dependency builds
  first. `packages/config` contains only configuration and requires no compilation.
- `pnpm typecheck`: compiles the retained starter library declarations first,
  then runs every available workspace typecheck through Turbo.
- `pnpm lint`: runs ESLint across all six NetSleuth workspaces.
- `pnpm test`: invokes the configured Turbo test task. **There are no test
  scripts or test suites yet**; no test coverage is claimed.
- `pnpm exec turbo run dev --filter='./apps/*'`: local-only development
  orchestration; uses the same defaults as the individual commands above.
  The root `dev` script is an alias, not a Replit preview workflow.
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
build inputs must be declared in `turbo.json` before use. No credentials are
required or stored by this foundation. Remote caching is not configured.

The NetSleuth package graph is intentionally one-way:

```text
web   -> shared
api   -> shared, database
agent -> shared
all five code workspaces -> config (development dependency only)
```

All arrows are explicit `workspace:*` links. Shared contracts remain a placeholder.
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
Web ── REST / Socket.IO ──> API ── Drizzle ──> PostgreSQL
Agent ── HTTP event ingestion ──> API
```

These connections are **planned, not implemented**. Socket.IO dependencies are
declared, but no server, client, or event listeners are enabled. Shared Zod
contracts belong in `packages/shared`; its entry point is intentionally empty.
The database package implements Drizzle/PostgreSQL schema and migration tooling.
Importing it has no connection side effects; call `createDatabase()` to initialize
a client with `DATABASE_URL`. `lib/db` delegates to it for starter compatibility.

The API's `createApp` function is the future composition boundary. Organize
future features into modules with transport/controllers, application services,
and domain layers; inject repositories, collectors, and detection policies at
composition time rather than binding them to Express. Do not add empty feature
implementations just to imply those systems already exist.

The agent must never import API internals or database repositories. It should
eventually depend only on shared contracts and its own collection/transport code.
The web application must never import server-only database code.

Tailwind CSS is configured. shadcn/ui configuration and its class utility are
prepared; no UI components or dashboard features have been generated.

## Architectural risks to resolve in later stages

- **Ingestion pressure:** define batch limits, bounded queues, timeouts, retries,
  idempotency, and retention before handling high-volume security events.
- **Identity and trust:** authenticate agents and users; authorize Socket.IO
  subscriptions, isolate tenants, validate events, and protect secrets.
- **Contract evolution:** version event contracts so independently deployed
  agents can tolerate control-plane upgrades.
- **Capture privileges:** tcpdump requires appropriate host visibility and
  permissions; do not make the control plane privileged. Container networking
  may hide the traffic you intend to inspect.
- **Sensitive observations:** packet metadata and PostgreSQL logs may contain
  sensitive information; plan redaction, encryption, and access restrictions.
- **Realtime deployment:** decide reverse-proxy WebSocket paths and multi-instance
  Socket.IO coordination before enabling live updates.
- **Portability:** keep capture platform assumptions explicit and infrastructure
  configuration separate from application code.

Authentication, ingestion, detections, PostgreSQL log
collection, packet capture, dashboards, Dockerfiles, and Compose are deferred.
No simulated events are presented as real observations.
