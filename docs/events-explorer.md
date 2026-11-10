# Network Events Explorer

`/dashboard/events` reads persisted events belonging to the selected authorized
project. It does not start collectors, generate traffic, change ingestion, or
claim packet-level visibility.

## API

Cookie-authenticated reads use the existing HttpResponse/HttpError conventions:

- `GET /api/v1/projects/:projectId/events` → `data: { events, pagination }`.
- `GET /api/v1/projects/:projectId/events/:eventRecordId` →
  `data: { event }`.

Both endpoints authorize actual workspace membership before querying events.
Every event query joins its agent and restricts that agent to the authorized
project. Details use the database record UUID, not the agent-supplied `eventId`.
Foreign project IDs/record IDs return 404. User Bearer authentication is not
accepted. Responses are `Cache-Control: no-store`.

### Filters and paging

All filters combine with AND in SQL:

| Parameter | Meaning |
| --- | --- |
| `limit` | 1–100; default 25 |
| `offset` | 0–1,000,000; default 0 |
| `eventType` | One of the six existing ingestion event types |
| `protocol` | TCP, UDP, OTHER |
| `sourceIp`, `destinationIp` | Exact IPv4 or IPv6 addresses, not prefixes/substrings |
| `agentId` | UUID; still restricted to this project |
| `start` | Inclusive ISO occurrence timestamp with timezone |
| `end` | Exclusive ISO occurrence timestamp with timezone, after start |

Zod rejects unknown parameters, repeated arrays, malformed IPs/UUIDs/dates,
unsupported enums, and invalid bounds. PostgreSQL inet equality handles
equivalent IPv6 spellings.

Rows sort by `occurredAt DESC, id DESC`. The repository fetches at most
`limit + 1` projected rows; the extra row supplies `hasMore`. No full-history
fetch or count scan is performed. Pagination returns `{ limit, offset, hasMore }`,
not a fabricated total. Offset pagination is not a point-in-time snapshot:
new insertions between requests can shift page boundaries. Refresh starts a
fresh view rather than promising a frozen event history.

The existing agent/time, type/time, occurrence-time, source/time, and
destination/time indexes are retained. No speculative migrations or new
infrastructure are introduced.

### Public data and evidence

List rows include record ID, project ID, agent ID/name, event type, source and
destination IP/nullable port, protocol, and occurrence timestamp. They omit
metadata and credential columns.

Details add the agent-supplied event ID, ingestion timestamp (`receivedAt`),
and metadata. Common sensitive property names are recursively redacted,
along with recognizable agent keys, JWTs, authorization strings, and credentialed
URLs; deeply nested content is bounded. This is defensive masking, not a
guarantee that arbitrary free-form agent content contains no sensitive data.
Do not send secrets in ingestion metadata. No original stored evidence is
modified by these reads.

TypeScript explorer DTOs live in the shared package. OpenAPI and generated
clients describe the same envelope. Existing ingestion schemas and behavior
remain unchanged.

## Verification

`apps/api/tests/event-explorer.test.ts` uses an isolated PostgreSQL schema that
is rolled back. It verifies:

- Stable newest-first pages, tie ordering, no duplicates in a static fixture,
  `hasMore`, and empty pages.
- Combined filters, equivalent IPv6 forms, IPv4, nullable ports, port zero,
  and inclusive-start/exclusive-end boundaries.
- Metadata/detail fields and nested credential masking.
- Cross-workspace denial, cross-project record denial, authorized member reads,
  missing cookies and Bearer-only rejection.
- Validation errors, including repeated filter arrays and reversed times.

Run:

```sh
pnpm --filter @workspace/netsleuth-api exec tsx --test --test-timeout=60000 tests/event-explorer.test.ts
pnpm --filter @workspace/netsleuth-web test
```

### Completed verification

- API integration tests: five scenarios plus the parent test passed.
- Web tests: ten passed, including three explorer query/validation tests.
- API/web builds, typechecks, lint, and generated-library checks passed.
- Browser verified 25 + 2 record pagination, newest-first order, combined type/
  protocol/IPv6/agent filters, clear-to-first-page behavior, invalid partial-IP
  feedback, detail JSON/redaction, empty project isolation, and 503/retry recovery.
- At 390px the table scrolled locally without widening the document. The detail
  dialog fit, scrolled internally, and restored focus after Escape.
- Browser date controls and debounce request counts were not independently
  exercised; backend date boundaries and client query construction were tested.
  Clipboard UI success was observed, but clipboard contents were not read.
- The browser's exact synthetic workspace, user, projects, agent, and 27 event
  records were removed and verified absent.

Frontend implementation is separated into `EventsContent`, `EventsFilters`,
`EventsTable`, `EventDetailDialog`, `useNetworkEvents` / `useEventDetails`, and
the filter/query helpers. Text filters wait 350ms and cancel obsolete requests;
results are rendered only for the matching project/filter/page request key.
