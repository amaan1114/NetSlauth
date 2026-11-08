# NetSleuth

Foundation for an open-source, self-hostable security observability platform.
This stage implements **only** workspace tooling and application entry points.
It does not implement security monitoring.

## Requirements and installation

- Node.js 22 or newer
- pnpm 10.26.1 (`corepack enable && corepack prepare pnpm@10.26.1 --activate`
  if your Node installation includes Corepack; otherwise install pnpm separately)

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck:netsleuth
pnpm run build:netsleuth
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
pnpm --filter @workspace/netsleuth-agent dev
```

After building, use `start` instead of `dev` in each command to run compiled output.
The API exposes only `GET /health`. A successful health response means the process
is reachable, **not** that ingestion, detection, or database connectivity works.
The agent does not run a background collector.

These commands are portable local-development commands, not configured Replit
preview services. Existing `artifacts/`, `lib/`, and `scripts/` are retained starter
packages and are not the NetSleuth applications. Existing preview workflows still
run those starters. Use the `*:netsleuth` commands to target only this foundation;
root `typecheck` and `build` also include retained starter packages.

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
tsconfig.netsleuth.json
```

Updated existing files: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`.gitignore`, and `replit.md`. Next.js generates `.next/` and may update its
generated `next-env.d.ts` during builds. Compiled files are ignored.

## Intended communication and boundaries

```text
Web ── REST / Socket.IO ──> API ── Drizzle ──> PostgreSQL
Agent ── HTTP event ingestion ──> API
```

These connections are **planned, not implemented**. Socket.IO dependencies are
declared, but no server, client, or event listeners are enabled. Shared Zod
contracts belong in `packages/shared`; its entry point is intentionally empty.
The database package declares Drizzle and PostgreSQL dependencies but has no
schema, migrations, connection side effects, or credentials.

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

Authentication, models, migrations, ingestion, detections, PostgreSQL log
collection, packet capture, dashboards, Dockerfiles, and Compose are deferred.
No simulated events are presented as real observations.
