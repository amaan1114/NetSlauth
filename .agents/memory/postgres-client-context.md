---
name: PostgreSQL client context
description: Inherited libpq settings can select the wrong identity for disposable local cluster checks.
---

Use an explicit database identity and target for disposable PostgreSQL CLI
verification rather than relying on inherited client defaults.

**Why:** a fresh local cluster's startup check selected a nonexistent role from
the ambient client context even though its host and port were explicit.
This environment can carry database client settings unrelated to a new cluster.

**How to apply:** keep isolated cluster validation separate from the application's
managed database configuration, and specify the intended role, database, host
and port in administrative checks. Never inspect or print credential values.
