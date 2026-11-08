# NetSleuth

Security observability platform, currently scoped to monorepo foundation only.

## NetSleuth foundation

- The requested applications live in `apps/web` (Next.js), `apps/api` (Express),
  and `apps/agent` (independent Node.js executable).
- Shared, database, and configuration package boundaries live in `packages/`; existing starter
  artifacts and libraries are preserved, not the product implementation.
- Turborepo orchestrates NetSleuth build, lint, typecheck, test, and local dev.
  Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`. No tests exist yet.
- Keep retained starter workspaces separate from NetSleuth. Default build/lint/dev
  target NetSleuth; full typecheck includes retained starter workspaces.
  **Why:** starter preview services have separate routing/runtime requirements.
- Shared strict TS and ESLint settings belong in `packages/config`.
  **Why:** applications should share one source of compiler/lint defaults.
- See `README.md` for the complete file list, architecture, and run commands.
- User scope: foundation only. Do not add authentication, database models,
  monitoring logic, or dashboard features without a later request.
- Keep the agent independent, detection logic outside controllers, configuration
  in environment variables, and all NetSleuth TypeScript configurations strict.
- Never claim simulated events are real observations; keep the project portable
  outside Replit.

The sections below describe retained starter tooling, not NetSleuth features.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Keep NetSleuth server code simple: use `console.log` instead of Pino, use
  Express with Node.js, and omit custom SIGINT/SIGTERM handlers.
  **Why:** the user explicitly requested a simpler server setup.
- Apply this simplicity to development source, including the running starter
  server, not just compiled output. Development should run TypeScript source directly.
  **Why:** the user clarified that source development code is what they want simplified.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
