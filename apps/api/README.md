# NetSleuth backend foundation

Small Express 5/TypeScript backend with cookie-based user authentication.
Workspace/agent authorization, ingestion, detections, and Socket.IO application
events are not implemented.

## Structure

```text
src/
  config/env.ts
  middleware/
    globalErrorHandler.ts
    requestLogger.ts
    authMiddleware.ts
  modules/auth/
    auth.routes.ts
    auth.controller.ts
    auth.service.ts
    auth.validation.ts
    auth.repo.ts
  modules/README.md
  services/database.ts
  utils/
    HttpResponse.ts
    HttpError.ts
    token.ts
  app.ts
  server.ts
  index.ts
tests/{foundation,auth,auth-client}.test.ts
.env.example
```

- `config/env.ts`: loads a package-local ignored `.env`, validates configuration
  with Zod, reports invalid field names without showing credentials, and exports
  the shared access/refresh cookie configuration.
- `services/database.ts`: initializes one pool/Drizzle client from the existing
  database package and implements readiness using a real `SELECT 1`.
- `app.ts`: installs Helmet, configured CORS, JSON/form parsers, health routes,
  JSON 404 handling, and the global error handler.
- `server.ts`: creates the Node HTTP server, attaches Socket.IO, listens, and
  closes HTTP/Socket.IO and the pool on SIGINT/SIGTERM. Shutdown is bounded to
  ten seconds. It does not create tables or run migrations.
- `index.ts`: compatibility entry point that imports `server.ts`; normal scripts
  use `server.ts` directly.
- `HttpResponse.ts`: consistent `{ success, statusCode, message, data? }` successes.
- `HttpError.ts`: intentional public HTTP errors with optional safe details.
- `globalErrorHandler.ts`: formats HttpError/Zod/parser failures and hides
  unexpected error messages and all stack traces.
- `requestLogger.ts`: console logging of method, path, status and duration.
  It does not log query strings, request bodies, headers or credentials.
- `modules/`: future feature modules are added when needed, not as empty folders.
  Keep routes, controllers, services and Zod validation separate.
  Auth uses direct named controller/service exports with explicit try/catch and
  `next(error)`. Database queries live in `auth.repo.ts`; token generation,
  signing, and verification live in `utils/token.ts`. There are no
  controller/service/router factories.

## Configuration

`DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` are required.
The two signing secrets must be different, random values of at least 32 bytes
(configuration enforces at least 32 characters). `PORT` defaults to 4000, `HOST` to `0.0.0.0`,
`NODE_ENV` to `development`, and `CORS_ORIGINS` to `http://localhost:3000`.
Multiple origins are comma-separated. Configure the actual frontend origin
before cross-origin browser use. CORS credentials are enabled for the configured
origins, without a wildcard. The Node server trusts one reverse-proxy hop; adjust
`trust proxy` for your own deployment topology.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access JWT lifetime (60–3600 seconds) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Refresh JWT lifetime (1 hour–30 days); must exceed access lifetime |
| `COOKIE_SECURE` | true in production, false otherwise | HTTPS-only cookies; production cannot disable it |
| `COOKIE_SAME_SITE` | `lax` | `lax`, `strict`, or `none`; `none` requires Secure |
| `COOKIE_DOMAIN` | omitted | Host-only cookies by default; set only when sharing across subdomains |

For a genuinely cross-site frontend/API deployment, use HTTPS,
`COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and the explicit frontend origin
in `CORS_ORIGINS`. Browsers can still block third-party cookies. Prefer same-site
frontend/API hosting when possible.

See `.env.example` for variable names; never commit real credentials.

## Run

From the repository root:

```sh
pnpm exec turbo run dev --filter=@workspace/netsleuth-api
pnpm exec turbo run build --filter=@workspace/netsleuth-api...
pnpm --filter @workspace/netsleuth-api start
pnpm --filter @workspace/netsleuth-api typecheck
pnpm --filter @workspace/netsleuth-api test
```

The configured Replit API workflow now runs this application through Turbo,
instead of the retained starter server. Turbo builds shared package dependencies
before development. Direct package `dev` assumes dependencies were built already.

The API remains alive if PostgreSQL is temporarily unreachable: liveness answers
200, while readiness checks the connection and answers 503. Pool connection and
query/statement timeouts are three seconds. Readiness proves reachability only,
not that application migrations are installed.

## Endpoints

- `GET /health` → 200, API is running.
- `GET /health/ready` → 200 if PostgreSQL responds, otherwise 503.
- `/api/health` and `/api/health/ready` are aliases for path-prefixed clients.
- `GET /api/healthz` retains the starter's `{ "status": "ok" }` response solely for
  compatibility; new endpoints use the standard envelope.
- Unknown API paths → JSON 404.
- `/socket.io/` supports the basic Engine.IO/Socket.IO handshake. There are no
  authentication, subscription, broadcast, or monitoring-event handlers.

Success:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "API is ready",
  "data": { "database": "connected" }
}
```

Error:

```json
{
  "success": false,
  "statusCode": 503,
  "message": "Database is unavailable"
}
```

OpenAPI remains in `lib/api-spec/openapi.yaml` with the existing `/api` base.
Regenerate clients/validators using
`pnpm --filter @workspace/api-spec codegen` after changing contracts.
Generic response types live in `@workspace/netsleuth-shared`.

## Verification

Unit tests exercise successes, failed readiness, JSON/parser limits, 404,
HttpError, Zod failures, unexpected-error redaction, headers and route aliases.
Database checks in unit tests are explicit test doubles, not real observations.
The running server's readiness endpoint must be checked separately to verify
the actual PostgreSQL connection.

Authentication tests use real bcrypt, JWT verification, and PostgreSQL in a
random temporary schema inside a rolled-back transaction. They do not create
accounts in the application's public tables. They check registration,
case-insensitive duplicate rejection, invalid input, password verification,
cookie-only access, token expiry/type checks, stateless refresh, cookie clearing,
and deleted users. A middleware test confirms no database query is required.
The frontend transport test verifies that requests send cookies directly,
without CSRF preflight requests or Authorization headers.

## Cookie authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Register and set access/refresh cookies |
| POST | `/api/v1/auth/login` | Verify credentials and set cookies |
| POST | `/api/v1/auth/refresh` | Verify refresh JWT and set new JWT cookies |
| POST | `/api/v1/auth/logout` | Clear browser cookies |
| GET | `/api/v1/auth/me` | Return safe user fields from PostgreSQL |

JWTs are **never returned in JSON or read from Authorization headers**.
`netsleuth_access` is an HTTP-only cookie at `/`; `netsleuth_refresh` is an
HTTP-only cookie at `/api/v1/auth`. Both use the configured SameSite/Secure/domain
options. Clearing cookies uses the same options and paths.

Authentication is stateless. Register/login set JWT cookies; middleware verifies
the access JWT signature and expiration and attaches `req.userId`. Only `/me`
and refresh look up the current user. No session records are created or queried.
The old `refresh_sessions` schema/table is retained but unused; this change
does not delete existing database data or rewrite migration history.

Logout only clears cookies. Copied access/refresh JWTs remain usable until they
expire; issuing a new refresh JWT does not invalidate the previous one. There
is no server-side revocation, replay detection, or absolute session limit.
CSRF middleware, tokens, and the `/csrf` endpoint have been removed at the user's
request. SameSite/Secure cookies and restricted CORS remain, but are not a
complete replacement for CSRF protection, particularly with SameSite=None.

`lib/api-client-react/src/custom-fetch.ts` always uses `credentials: "include"`,
and does not send Authorization. Writes go directly to their endpoint.
No browser local/session storage is used for tokens. Automatic retries/refresh
and frontend sign-in screens are not part of this backend module.

### Example browser request

```ts
const response = await fetch("/api/v1/auth/register", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Example User",
    email: "example@example.invalid",
    password: "replace-with-a-strong-password",
  }),
});
const result = await response.json();
```

Example registration response (HTTP 201):

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Registration successful",
  "data": {
    "user": {
      "id": "09f6cda0-21f2-4b41-9ee4-8f9e253a7db0",
      "name": "Example User",
      "email": "example@example.invalid",
      "createdAt": "2026-11-09T10:00:00.000Z",
      "updatedAt": "2026-11-09T10:00:00.000Z"
    }
  }
}
```

Missing access cookies return HTTP 401 with the existing error envelope:

```json
{
  "success": false,
  "statusCode": 401,
  "message": "Access cookie is required"
}
```

Login/registration share a process-local limit of 30 attempts per IP per
15 minutes. A shared rate-limit store is needed before horizontal scaling.
No password recovery or email verification is implemented.
