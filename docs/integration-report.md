# NetSleuth integration verification

## Verified behavior

- Browser user registration, login, refresh/logout and authorization use HTTP-only
  cookies, not Bearer tokens.
- Workspace/project authorization prevents cross-workspace reads and writes.
- Agent registration returns a new key once and stores its SHA-256 hash.
  Agent detail/list responses omit credentials; revocation prevents ingestion.
- The actual running Linux collector observed a controlled local TCP test socket
  through `ss`, published its UUID event over HTTP using `X-Agent-Key`, and
  persisted it through the actual Express middleware/services and PostgreSQL.
- Actual heartbeat publishing updated the authenticated agent to ONLINE.
- A temporary HTTP 503 outage exhausted bounded retries without crashing the
  agent; collection continued and heartbeat publishing recovered afterwards.
- Replaying a collected UUID returned a duplicate acknowledgement and left alert
  evidence/timestamps unchanged. Payload-supplied identity/scope was rejected.
- Database-policy allowlisting, unexpected connection alerts, authentication
  failure thresholds/source isolation, deduplication, evidence preservation and
  project-scoped alert retrieval were exercised.
- Captured integration logs contained no test passwords, issued keys or key hashes.
  One-time key issuance remains an intentional registration response.
- Fresh PostgreSQL migration CLI execution created eight application tables and
  four journal entries in a disposable local cluster.
- The current development schema contains the required credential, policy and
  event-id columns. Existing application tables were not altered.

## Executed checks

| Check | Result |
| --- | --- |
| `pnpm test` | 65 API + 22 agent tests passed; zero failed or skipped. |
| `pnpm test:e2e` | 8 tests passed, including seven sequential integration scenarios; zero failed or skipped. |
| Database `test:db` | 1 top-level constraint/scoped-query suite passed; SQL assertions cover foreign keys, uniqueness, enums, ports, IPs, evidence, tenant scope and cascade isolation. |
| `pnpm lint` | Passed for all six NetSleuth packages. |
| `pnpm typecheck` | Passed, including retained starter workspaces. |
| `pnpm build` | Passed for API, agent, shared/database packages and the Next.js placeholder. |
| Next.js `start` smoke check | HTTP 200 and the existing placeholder rendered; the test server was then stopped. |
| Managed API smoke check | Readiness returned 200; ingestion and agent detail rejected missing credentials with 401, not 404. |
| Fresh `db:migrate` | Passed against temporary PostgreSQL 16; all four migrations applied. |

Database suites used fresh transaction-local schemas and rolled back their data.
The separate migration CLI check used a new disposable local cluster, stopped
and removed afterwards. No destructive changes were made to application data.
Tests require working PostgreSQL configuration; they do not silently skip it.

The integration test composes actual application services in-process, binds a
real ephemeral HTTP listener, and runs the actual agent runtime/collector. Its
database connection is bound to the rollback-only schema for safety. This is
not a production deployment/load test. The controlled socket is not a real
database connection; authentication-failure events are explicitly synthetic
evidence fixtures, never inferred from socket metadata.

## Fixed integration gaps

1. Mounted `/api/v1/ingest` in the Express app. The implemented ingestion router
   previously existed but was unreachable.
2. Mounted cookie-protected `/api/v1/agents` so existing detail/revocation routes
   are reachable.
3. Excluded the separately configured agent from root `pnpm dev`, preventing its
   missing credentials from taking down normal web/API development.
4. Disabled Turbo test-result caching: cached success is not verification of
   current PostgreSQL or runtime behavior.
5. Added bounded API test execution and an explicit root `test:e2e` command.

The initial API baseline failed route assertions and timed out. After route
wiring was corrected, the full API suite and root test command passed.
The temporary PostgreSQL startup check initially inherited a mismatched CLI
role; explicitly selecting the cluster's owner fixed that check.

## Missing features and remaining blockers

There is **no functional browser dashboard or browser authentication UI**.
Frontend compilation is not evidence of a completed user-facing application.
The verified end-to-end path is the HTTP/API/agent path, not a dashboard journey.
No new frontend screens, database architecture, authentication system, broker,
or background recovery infrastructure were added.

Production readiness remains blocked by the intentionally missing operational
features documented in the root README: durable delivery/detection recovery,
authenticated realtime subscriptions, authentication-log collection, stale-agent
status transitions, alert-state management and additional hardening.

Linux connection-table polling does not provide full packet visibility. The
workspace test proves visibility in its Linux network namespace only. Actual
target-host visibility must still be validated on Linux; a Docker Desktop
container does not automatically observe the macOS/Windows host.

Starting a real monitoring agent additionally requires a registered key and the
correct reachable API origin. Integration test credentials are temporary,
rolled back and deliberately not retained as a configured monitoring agent.

For local commands and environment setup, see the root README, API README,
database README and agent README. Do not replay migrations blindly against an
existing schema with an empty migration journal.
