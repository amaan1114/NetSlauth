---
name: Development migration baseline
description: Avoid replaying initial migrations against a development schema created outside Drizzle history.
---

The development database was populated outside the Drizzle migration journal.
Its tables existed while the journal was empty. Agent credential columns were
applied additively; the journal was not stamped with an unverified baseline.

**Why:** Running the full migration command tried to recreate existing tables.
An empty journal does not prove the database is empty.

**How to apply:** Inspect schema and migration history before applying future
development migrations. Apply reviewed missing changes without dropping data
or blindly marking old migrations complete. Fresh disposable test schemas can
still run the full migration sequence. Do not add startup or production DDL.
