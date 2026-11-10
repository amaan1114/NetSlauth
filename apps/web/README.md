# NetSleuth web

Next.js App Router frontend using the existing Express cookie authentication.
No separate identity provider, browser token storage, or Bearer authentication.

## Run locally

Start the existing API (port 4000 by default), then:

```sh
pnpm --filter @workspace/netsleuth-web dev
```

Open `http://localhost:3000`. Optional configuration is in `.env.example`;
set `NETSLEUTH_API_URL` in `.env.local` if the API uses another origin.
This is a server-only rewrite destination, never a JWT secret.

In Replit, the existing product artifact runs both services: Web on `/` and
API on `/api`. The shared proxy routes API calls without the local rewrite.

## Routes

- `/` redirects to `/dashboard`.
- `/login` and `/register` submit to the existing authentication endpoints.
- `/dashboard` shows project-scoped aggregate metrics, network/authentication
  activity, severity distribution, recent alerts and bounded agent health.
- `/dashboard/agents`, `/dashboard/events`, `/dashboard/alerts` show scoped
  foundation screens, not records or management features.
- `/dashboard/settings` shows read-only account and selected project details.

The shared dashboard layout checks `/api/v1/auth/me` before rendering protected
content. An expired access cookie triggers one refresh and retry; refresh
failures with 401 redirect to login. Network/server failures show a retry state,
not a misleading logout. Cookies are HTTP-only; browser requests include
credentials. Failed logout stays on the current screen with an error because
client code cannot clear HTTP-only cookies.

## API integration

The small `src/lib/api.ts` client uses the existing shared HTTP response types.
The retained starter-generated client does not cover these NetSleuth endpoints.

- `POST /api/v1/auth/login`, `/register`, `/refresh`, `/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/workspaces`
- `GET /api/v1/workspaces/:workspaceId/projects`
- `GET /api/v1/projects/:projectId/dashboard/summary`
- `GET /api/v1/projects/:projectId/dashboard/activity?range=24h`

Workspace/project selections are stored under the current user's ID, then
validated against current authorized API results before being used. Changing
workspace immediately clears the old project. Stale responses are ignored.
Lists refresh on focus and every minute; all requests remain backend-authorized.
Logout clears user-scoped browser state.

## Scope

The overview uses persisted backend data, not sample alerts or invented health
states. Agent management supports project-scoped lists, one-time registration
credentials and setup instructions, details, and confirmed revocation using the
existing backend APIs. See [agent management](../../docs/agent-management.md).
The Network Events Explorer adds project-scoped paginated events, combined
server-side filters, and metadata details. See [event exploration](../../docs/events-explorer.md).
Alert investigation includes scoped evidence, related events, and confirmed
acknowledge/resolve/reopen actions. See [investigation](../../docs/alert-investigation.md).
Editable settings are not included. Workspace and
project creation still use the existing API. No backend changes or new runtime
dependencies were needed for the original foundation; the overview adds two
read-only aggregate endpoints and reuses the workspace's Recharts library.

## Overview semantics

See [the overview API contract](../../docs/dashboard-overview.md). Summary
counts are all-time; critical/severity counts include all alert statuses.
The event total includes heartbeat and service records, while the chart
separates network connections from authentication and reports omitted
heartbeat/service counts. Timeseries uses `occurredAt`, not ingestion time.
Agent status is the stored value; an old heartbeat does not automatically
change it. Requests are scoped to project/range, refreshed on navigation,
manual refresh and focus, not a real-time stream. Alert context links retain
the alert ID on the existing alerts route; investigation detail remains deferred.

## Verification

```sh
pnpm --filter @workspace/netsleuth-web test
pnpm --filter @workspace/netsleuth-web lint
pnpm --filter @workspace/netsleuth-web typecheck
pnpm --filter @workspace/netsleuth-web build
```

The seven client tests use Node's built-in TypeScript stripping (Node 22.6+
or the workspace's Node 24), with no additional test dependencies. They cover
credentialed JSON requests, response envelopes, refresh/retry, refresh rejection,
server/network errors, and concurrent refresh requests.

Browser verification covered registration/sign-in, protected-route redirects,
two authorized workspaces with separate projects, selection persistence,
invalid stored IDs, all dashboard routes, mobile navigation without overflow,
and logout/sign-in again. Temporary test records were removed. Failed-logout
network simulation was not browser-tested; the client retains the signed-in
screen and reports the request failure rather than pretending cookies cleared.
