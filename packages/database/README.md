# NetSleuth database

This is the single source of truth for NetSleuth's PostgreSQL schema and client.
`lib/db` is now a compatibility wrapper for the retained starter; it delegates
client initialization and re-exports this schema instead of maintaining another
implementation. `packages/shared` remains independent of database internals.

## Files

```text
src/
  schema/
    users.ts
    workspaces.ts
    workspace-members.ts
    projects.ts
    agents.ts
    network-events.ts
    security-alerts.ts
    index.ts
  client.ts
  queries.ts
  index.ts
drizzle/
  0000_netsleuth_initial.sql
  meta/
    0000_snapshot.json
    _journal.json
tests/
  constraints.sql
.env.example
drizzle.config.ts
package.json
tsconfig.json
tsconfig.tools.json
```

## Tables and relationships

All IDs are PostgreSQL UUIDs, generated with `gen_random_uuid()` by default.
All timestamps are `timestamptz` and exposed as JavaScript `Date` values.

| Table | Fields |
| --- | --- |
| users | id, name, email, passwordHash, createdAt, updatedAt |
| workspaces | id, name, createdAt, updatedAt |
| workspace_members | id, userId, workspaceId, role, createdAt |
| projects | id, workspaceId, name, nullable description, createdAt, updatedAt |
| agents | id, projectId, name, status, nullable lastHeartbeatAt, createdAt, updatedAt |
| network_events | id, agentId, eventId, eventType, sourceIp, nullable sourcePort, destinationIp, nullable destinationPort, protocol, metadata, occurredAt, receivedAt |
| security_alerts | id, projectId, nullable agentId, title, description, severity, status, ruleId, fingerprint, evidence, firstSeenAt, lastSeenAt, createdAt, updatedAt |

```text
users <-> workspace_members <-> workspaces
                                 |
                              projects
                              /      \
                           agents   security_alerts
                             |          |
                       network_events   +-- optional agent in the SAME project
```

Membership roles: OWNER, ADMIN, MEMBER. Agent statuses: ONLINE, OFFLINE, INACTIVE
(default). Alert severity: LOW, MEDIUM, HIGH, CRITICAL. Alert status: OPEN
(default), ACKNOWLEDGED, RESOLVED.

Event IDs, event types, protocols, and rule IDs are text: independently deployed
agents and future detection rules must not require a database enum migration
for each new event or rule. `ruleId` is not a foreign key because no rules table
exists in this phase.

## Constraints and indexes

- Emails are case-insensitively unique using `lower(email)`.
- Membership is unique on `(userId, workspaceId)`. Additional workspace index
  supports listing members; the unique index supports a user's memberships.
- Projects are indexed by workspace; agents by `(projectId, status)`.
- Events are unique on `(agentId, eventId)` for ingestion idempotency.
- Event indexes support `(agentId, occurredAt)`, `(eventType, occurredAt)`,
  global occurrence time, source-IP/time, and destination-IP/time queries.
- IPs use `inet` for IPv4 and IPv6. Ports allow NULL for protocols without ports;
  present values must be integers between 0 and 65535.
- Alert `(agentId, projectId)` references the same pair on agents. An alert cannot
  name an agent from another project/workspace; NULL agent IDs permit project-wide
  alerts. The supporting unique agent pair is required for this composite FK.
- Alerts are unique on `(projectId, fingerprint)`. Fingerprints must include rule
  and subject/scope identity; repeated occurrences update the same alert, even
  after resolution. Reopening versus creating a new incident is future detection
  policy, not implemented here.
- Alert indexes support project/status/severity, project/lastSeenAt, and agent.
- Alert `lastSeenAt` cannot precede `firstSeenAt`.
- Event metadata and alert evidence are JSONB objects. Do not put raw packets,
  credentials, or secrets in either field. No raw-payload or agent-key column exists.
- `$onUpdate` maintains `updatedAt` for Drizzle updates. Raw SQL must explicitly
  update that timestamp; this is not a database trigger.

**Delete behavior:** deleting a workspace deletes its memberships, projects,
agents, events, and alerts; users are preserved. Deleting a user deletes only
their memberships. Deleting a project deletes its monitoring data. Deleting an
agent deletes its events and associated alerts, not project-wide alerts.
Application deletion flows must require authorization and clearly warn about
this destructive behavior before they are implemented.

## Connection and migrations

Set `DATABASE_URL` in the process environment. For Drizzle CLI commands, a local
ignored `packages/database/.env` is also supported by dotenv; `.env.example`
contains only the variable name and no credentials.

```sh
pnpm --filter @workspace/netsleuth-database db:generate
# Applies migrations to the database named by DATABASE_URL. Development/local use:
pnpm --filter @workspace/netsleuth-database db:migrate
pnpm --filter @workspace/netsleuth-database typecheck
pnpm --filter @workspace/netsleuth-database build
```

Generation is offline and does not require credentials. `db:migrate` does require
a valid connection URL. No migration runs on import, API startup, build, or deploy.
For Replit-managed production databases, use the supported Publish schema flow;
do not run this development migration command as a production deploy hook.

From `apps/api`, after the dependency build:

```ts
import {
  createDatabase,
  listNetworkEventsInProject,
} from "@workspace/netsleuth-database";
import type { ProjectScope } from "@workspace/netsleuth-database";

// Initialize once at future API composition time, NOT for every request.
const { db, pool } = createDatabase();
// The future auth/service layer must authorize this workspace first.
const scope: ProjectScope = { workspaceId, projectId };
const events = await listNetworkEventsInProject(db, scope);
// When an owning process is finished with the client:
await pool.end();
```

The scope identifiers in this example come from the future authorized service;
this snippet is documentation, not an API implementation.

Importing the package or its `/schema` subpath does not create a connection.
`createDatabase()` returns the typed Drizzle client and its pool; the caller owns
the pool lifecycle. Connections use PostgreSQL URL parameters for TLS settings;
certificate verification is not disabled.

## Security boundary

The provided read helpers require a Zod-validated workspace/project scope and
filter through project ownership. They return at most 100 newest rows.
They are **not authentication or PostgreSQL row-level security**. The API must
authorize workspace membership before supplying the scope, and must apply the
same scope to all future reads, updates, and deletes. Direct raw Drizzle queries
are not automatically tenant-isolated.

`passwordHash` is a required nonempty storage field, never a plaintext-password
field. Callers must supply an actual secure password hash; the database does not
hash or cryptographically verify arbitrary strings. Password hashing, response
redaction, authentication, and agent credential issuance are not implemented.
Do not expose complete user rows as API responses.

## Verification

The initial migration and `tests/constraints.sql` can be executed in a temporary
PostgreSQL schema inside one transaction and rolled back. The verification harness
must replace the migration's `"public".` qualifiers with the temporary schema and
set a transaction-local search path before executing the SQL. Never run the test
fixtures against an application's real tables.

Checks cover membership/email uniqueness, per-agent event deduplication, port
ranges, foreign keys, project-wide alerts, cross-project alert rejection,
project-scoped fingerprints, timestamp ordering, workspace-scoped event reads,
and cascade isolation. Test fixtures are not captured observations.
