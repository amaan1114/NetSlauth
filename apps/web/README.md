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
- `/dashboard` shows the actual authorized workspace/project context.
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

Workspace/project selections are stored under the current user's ID, then
validated against current authorized API results before being used. Changing
workspace immediately clears the old project. Stale responses are ignored.
Lists refresh on focus and every minute; all requests remain backend-authorized.
Logout clears user-scoped browser state.

## Scope

No metrics, sample alerts, invented health states, agent management, event
explorer, alert investigation, or editable settings are included. Workspace and
project creation still use the existing API. No backend changes or new runtime
dependencies were needed.

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
