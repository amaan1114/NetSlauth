# Security alerts and investigation

`/dashboard/alerts` uses persisted project alerts and their stored evidence.
Detection rules, ingestion, schema, and automatic lifecycle behavior are not
changed. No traffic, alerts, history, blocking, or remediation are generated.

## Endpoints

All endpoints use existing HTTP-only user cookies, HttpResponse/HttpError,
workspace membership authorization, project scope, and no-store responses.

| Method | Path | Unwrapped response |
| --- | --- | --- |
| GET | `/api/v1/projects/:projectId/alerts` | `{ alerts, pagination: { page, limit, hasMore } }` |
| GET | `/api/v1/projects/:projectId/alerts/:alertId` | `{ alert, agent }` |
| PATCH | `/api/v1/projects/:projectId/alerts/:alertId/status` | `{ alert, agent }` |
| GET | `/api/v1/projects/:projectId/alerts/:alertId/events` | `{ events, pagination: { page, limit, hasMore } }` |

The existing list endpoint keeps its envelope and adds optional `ruleId`,
`sourceIp`, `start`, and `end` filters to severity/status/page/limit.
Rule ID is an exact match; IP searches are exact IPv4/IPv6 matches against the
canonical source address saved by detection. Scope-zone suffixes are rejected.
Time bounds filter **lastSeenAt**, inclusive at start and exclusive at end.
All filters combine in SQL. Page defaults to 1, limit to 20 (maximum 100).
Rows sort by lastSeenAt descending, then ID ascending. Each list reads at most
limit + 1 rows, without loading history or calculating a global total.

Details return the existing alert fields with evidence defensively redacted
using the event explorer's common credential masking. Associated agent reads
project-check their ID and select only ID/name. Cross-project access is 404.
Credentials and agent hashes are not projected.

Status updates accept exactly `{ status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" }`.
Any authorized project member can explicitly acknowledge, resolve, or reopen.
Only status and update time are written; first/last observation times,
creation time, and evidence remain unchanged. A status update is not a new
observation and does not produce a fictional timeline entry.

## Evidence and related events

Authentication bursts store source/destination, failure count, threshold,
window duration/bounds, public event IDs, and internal event references with
agent IDs. Database destination alerts store endpoint information, the observed
connection kind, one public event ID, and the destination policy snapshot used
by detection. Missing fields are unavailable, not guessed.

Related-event reads are paginated and restricted to agents in the alert's
project. Authentication references must match both internal record ID and agent
ID. A single-event reference must match the alert's associated agent and public
event ID, since public IDs are unique only per agent. A reused public UUID must
never attach another agent's event. Malformed/missing legacy evidence returns
no inferred related history.

Related event details reuse
`GET /api/v1/projects/:projectId/events/:eventRecordId`. The evidence viewer is
read-only and JSON is rendered as text, not HTML.

## Interpretation and lifecycle boundaries

- Authentication failures are reported facts, not proof of malicious intent.
- A configured database port is not evidence of a successful database login.
- A connection attempt is distinct from an established connection, and neither
  proves application-level authentication.
- Policy evidence is the snapshot used for that observation, not necessarily
  today's current project policy.
- First/last observations and evidence window/event timestamps support a
  bounded timeline, not a complete audit trail or all historical observations.
- The existing detector does not update/reopen resolved alerts. Explicit
  reopening is now a user action; no silent lifecycle change was introduced.
- There is no status-history table or actor audit log in the existing schema.
  The UI must not imply that one exists.

No indexes or migrations were needed: project/last-seen and
project/status/severity indexes already exist.

## Verification

`apps/api/tests/alert-investigation.test.ts` uses an isolated, rollback-only
PostgreSQL schema. It checks combined filters and half-open last-seen ranges,
stable bounded pages, safe details, cross-project/agent reference isolation,
malformed evidence, member status persistence, unchanged observation evidence,
unauthorized reads/writes, and validation. Existing detection tests also run to
confirm resolved-alert behavior and ingestion/detection compatibility.

```sh
pnpm --filter @workspace/netsleuth-api exec tsx --test --test-timeout=60000 tests/alert-investigation.test.ts tests/detections.test.ts
```
