# Feature modules

Add `auth`, `users`, `workspaces`, `projects`, `agents`, `events`, and `alerts`
directories when their features are implemented, not as empty boilerplate.

For example, the agents module will contain `agent.routes.ts`,
`agent.controller.ts`, `agent.service.ts`, and `agent.validation.ts`.
Routes wire endpoints, controllers handle HTTP, services own business logic and
scoped database queries, and validation files contain Zod input schemas.
Controllers should use the shared HttpResponse and HttpError utilities.
