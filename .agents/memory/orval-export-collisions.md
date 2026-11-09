---
name: Orval export collisions
description: Generated Zod path validators and TypeScript query DTOs can have the same exported name.
---

When an operation has both path and query parameters, Orval can name its Zod
path validator and TypeScript query DTO identically. Its export-name allocator
does not reliably detect the collision across separately generated outputs.
Generation itself can succeed while the combined barrel fails TypeScript.

**Why:** This surfaced when adding the first paginated project-scoped endpoint;
the existing body-schema naming guidance does not cover this path/query case.

**How to apply:** Always run the chained library typecheck after codegen. Prefer
a narrow generator override for a redundant validator already covered by the
API's reusable path validation; never manually patch generated outputs.
