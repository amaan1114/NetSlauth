# NetSleuth backend foundation

Small Express 5/TypeScript backend. No authentication, feature controllers,
ingestion, detections, or Socket.IO application events are implemented.

## Structure

```text
src/
  config/env.ts
  middleware/
    globalErrorHandler.ts
    requestLogger.ts
  modules/README.md
  services/database.ts
  utils/
    HttpResponse.ts
    HttpError.ts
  app.ts
  server.ts
  index.ts
tests/foundation.test.ts
.env.example
```

- `config/env.ts`: loads a package-local ignored `.env`, validates configuration
  with Zod, and reports invalid field names without showing credentials.
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

## Configuration

`DATABASE_URL` is required. `PORT` defaults to 4000, `HOST` to `0.0.0.0`,
`NODE_ENV` to `development`, and `CORS_ORIGINS` to `http://localhost:3000`.
Multiple origins are comma-separated. Configure the actual frontend origin
before cross-origin browser use. Credentials/cookies are not enabled by CORS.
No wildcard origin is required.

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
