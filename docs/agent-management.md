# Agent management

The existing Next.js dashboard exposes project-scoped agent management at
`/dashboard/agents`. It uses the same cookie-authenticated API client and
workspace/project selection as the overview.

## Existing endpoints

All paths below are relative to the current NetSleuth API origin:

| Method | Path | Request / response data |
| --- | --- | --- |
| GET | `/api/v1/projects/:projectId/agents` | `{ agents }` |
| POST | `/api/v1/projects/:projectId/agents` | Body `{ name }`; returns `{ agent, apiKey }` |
| GET | `/api/v1/agents/:agentId` | `{ agent }` |
| POST | `/api/v1/agents/:agentId/revoke` | `{ agent }` |

The existing server checks membership in the agent's actual workspace.
Client-side selection is not authorization. Listing returns at most the 100
newest agents; the API has no pagination parameters or total count.
Registration supports a name only, not a description.

Public agent fields are ID, project ID, name, stored status, heartbeat,
revocation timestamp, registration timestamp, and update timestamp. Credential
hashes are excluded by the existing repository projection.

## Status and credentials

`revokedAt` takes precedence when displaying **REVOKED**. Other agents retain
their stored **ONLINE**, **OFFLINE**, or **INACTIVE** status. An old heartbeat
does not automatically change stored status; this interface does not introduce
an offline scheduler or claim live collector health.

Registration returns a high-entropy API key once. Only its SHA-256 hash is
stored by the server. The setup flow holds the plaintext key temporarily in
memory; it must not be written to browser storage, URLs, logs, or error messages.
Closing setup or leaving its project discards it. Details cannot recover it.
Reloading the page also discards it: retaining a key across a full reload would
require persistence, which is intentionally prohibited.
Copying configuration intentionally puts the key on the user's clipboard;
the user must treat that clipboard content as a secret.

Revocation requires confirmation, sets the revocation timestamp, and prevents
subsequent agent authentication/ingestion. It does not delete historical events
or stop the process running on the remote host.

## Running the real agent

See `apps/agent/README.md` for the authoritative setup instructions. The agent
requires a Linux host, Node.js 22+, pnpm, and `ss` from iproute2.
Commands run from an existing monorepo checkout root:

```sh
pnpm install
pnpm exec turbo run build --filter=@workspace/netsleuth-agent...
pnpm --filter @workspace/netsleuth-agent start
```

Supply `NETSLEUTH_API_URL`, `NETSLEUTH_AGENT_KEY`,
`COLLECTION_INTERVAL_MS=10000`, and `HEARTBEAT_INTERVAL_MS=30000` through the
target host's environment or its ignored `apps/agent/.env`. Do not put the key
in source control or command-line arguments.

The API URL is the server base URL, not `/api` or the ingestion endpoint.
The setup UI's current-origin suggestion is not a published URL or evidence
that a remote host can reach it. Use the correct reachable deployment URL.
Production requires HTTPS; explicitly choose development mode for local HTTP.

## Verification

Frontend components:

- `AgentsContent` / `ProjectAgents`: scope handling, lists, filters, registration,
  details, and confirmed revocation.
- `RegistrationSetup`: transient one-time credential, actual agent commands,
  editable API origin, and clipboard feedback.
- `AgentDialog`: native modal dialog with keyboard cancellation.

Verification performed:

- Web typecheck, lint, production build, and seven existing API-client tests
  passed.
- Ten targeted API integration tests passed, including their parent test.
- Signed-in browser checks passed for empty/list states, registration, actual
  INACTIVE status, clipboard contents, no key in URL/browser storage, project
  isolation, safe details, confirmation/retry/revocation, and revoked state
  after reload.
- Injected list and revoke failures were visible and recoverable without
  signing the user out.
- At a 390px viewport the table scrolled locally without widening the document;
  the details modal fit and received focus. Escape dismissed registration.
- Full reload correctly discarded the one-time setup. A separate focus-event
  refresh and explicit Done-button dismissal were not browser-verified: the
  follow-up encountered the preview's private-app login gate after cleanup.
  Source inspection confirms that Done clears the transient registration state;
  same-project temporary scope loading preserves it.
- All browser fixtures were removed by their exact synthetic ownership scope.

Existing API integration coverage is in `apps/api/tests/agents.test.ts`:
cookie-only management, one-time keys/hash storage, real workspace authorization,
safe list/detail projections, strict registration validation, and revocation
rejecting subsequent key authentication. Fixtures use an isolated PostgreSQL
schema and roll back rather than modifying product records.

Run web lint/typecheck/tests and the targeted API integration test:

```sh
pnpm --filter @workspace/netsleuth-web lint
pnpm --filter @workspace/netsleuth-web typecheck
pnpm --filter @workspace/netsleuth-web test
pnpm --filter @workspace/netsleuth-api exec tsx --test --test-timeout=60000 tests/agents.test.ts
```
