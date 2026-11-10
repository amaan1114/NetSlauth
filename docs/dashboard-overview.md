# Dashboard overview

The overview is `/dashboard` in the existing Next.js application. It reuses
the cookie client, authenticated shell and validated project selection.

## Read-only API

Both endpoints require the existing `netsleuth_access` cookie. They validate the
project UUID and resolve the authenticated user's workspace membership through
`getProjectService` **before** issuing aggregate queries. Non-members receive
404 without project data; missing/expired access receives 401. Responses use
the existing `HttpResponse` envelope with `Cache-Control: no-store`.

### GET `/api/v1/projects/:projectId/dashboard/summary`

`data` is `DashboardSummary`, exported by `@workspace/netsleuth-shared`:

- `projectId`, `generatedAt`.
- `metrics`: `totalAgents`, `onlineAgents`, `offlineAgents`, `inactiveAgents`,
  `totalNetworkEvents`, `openAlerts`, `criticalAlerts`.
- `severityDistribution`: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` counts.
- `recentAlerts`: latest **8** by first-seen time descending, ID as tie-breaker.
  Each includes ID, project ID, title, severity, status, detection rule ID,
  source IP if the evidence contains a string, and first-seen timestamp.
- `agentHealth`: first **10** agents by ID, `limit` and `hasMore`.
  Each includes ID, project ID, name, stored status, last heartbeat, revocation
  time. API key hashes are never selected or returned.

Counts are **all-time**, not restricted to the chart's range. Total agents
includes all registered rows, including inactive/revoked agents. ONLINE,
OFFLINE and INACTIVE are separate stored enum values; inactive is not offline.
The backend currently has no automatic stale-heartbeat OFFLINE scheduler:
the UI shows last heartbeat and does not infer current connectivity.

The event total counts all persisted rows, including heartbeat/service types.
Open alerts means `status = OPEN`; critical alerts and severity distribution
include **all statuses**, including acknowledged/resolved. Alerts are detection
signals, not proof of a successful attack.

Counts are aggregated by PostgreSQL; only small enum groups and bounded lists
cross the application boundary. Related queries may observe concurrent writes
at slightly different times: this is a read view, not an atomic audit snapshot.

### GET `/api/v1/projects/:projectId/dashboard/activity?range=24h`

Supported ranges:

| Range | Interval | Buckets |
| --- | --- | --- |
| `1h` | 5 minutes | 12 |
| `24h` (default) | 1 hour | 24 |
| `7d` | 6 hours | 28 |

The endpoint captures one server `to` timestamp and computes `from`, then
groups persisted events by **occurrence time**, including `from` and excluding
`to`. Future/out-of-window events are excluded. UTC buckets begin at `from`,
empty buckets are zero-filled, and the client formats dates in the viewer's
timezone. No unbounded event history is returned.

Each bucket has `start`, `network` (connection attempts + established),
`authentication` (success + failure), `heartbeat`, and `service` counts.
The chart compares network and authentication series; omitted heartbeat and
service counts are disclosed beneath it. Stored event types are validated at
ingestion; this read endpoint does not infer authentication outcomes.

The existing agent/project-time and alert project/severity/status indexes
support these queries. No new tables, indexes, migrations, queues or services
were needed. PostgreSQL must still scan relevant indexed rows for exact counts.

## UI behavior and boundaries

Summary and activity resolve independently. Range changes fetch activity only;
project changes abort obsolete requests and hide mismatched project/range data
immediately. Refresh and focus request fresh data, with a fetched timestamp.
There is no real-time or WebSocket claim. Errors show retry, not fabricated
zero counts; refresh-token expiration follows the existing auth flow.

Recent alert links use `/dashboard/alerts?alertId=...`, which is the existing
alerts foundation route, not an implemented investigation screen. This preserves
the alert identifier without inventing a broken detail route. No agent
management, full event explorer or alert investigation was implemented.

The source contract is documented in `lib/api-spec/openapi.yaml`; regenerated
clients/Zod outputs are retained. The overview itself reuses the existing
small fetch client and shared DTOs. Its chart dependency is the same Recharts
version already available elsewhere in this workspace.

## Verification

`apps/api/tests/dashboard.test.ts` uses an isolated PostgreSQL schema and
rollback-only fixtures. It checks exact metrics/severity, bounded/sanitized
lists, empty projects, 1h/24h/7d categories, exact inclusive/exclusive boundaries,
future events, project/workspace isolation, member access, cookie-only auth,
invalid queries and no-store headers. All fixtures/schema are rolled back.

API dashboard tests passed (7 including the parent suite), as did the 7 existing
web-client tests, API/web type checks and lint, generated-library checks, and
API/web builds. Browser checks compared a synthetic persisted project's exact
counts against the overview, exercised chart ranges/tooltip, empty/rapid project
switches, alert-context navigation and an injected 503/retry recovery.
Targeted mobile checks passed at 390px and 375px: document width stayed within
the viewport while the alerts table retained local horizontal scrolling.
All browser-test accounts and scoped records were deleted after verification;
no synthetic dashboard records remain.
