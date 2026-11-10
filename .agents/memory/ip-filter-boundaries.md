---
name: IP filter boundaries
description: Schema IP validation can accept forms that PostgreSQL inet cannot query.
---

Validate query addresses against both the shared IP rules and the database's
accepted syntax. Explicitly reject interface-zone suffixes in explorer filters.

**Why:** the installed Zod IP validator accepts scoped IPv6 such as
`fe80::1%eth0`, but PostgreSQL `inet` does not accept the interface zone.
Relying on `.ip()` alone can turn user input into a database error instead of
a useful validation response. A separate handwritten browser IP parser also
incorrectly rejected valid IPv4-mapped IPv6.

**How to apply:** reuse shared validation in the browser rather than maintaining
another IP parser; apply the same storage-specific restrictions on both sides.
Test compressed, expanded, IPv4-mapped, malformed, and scoped IPv6 addresses
when changing address filters. Do not silently strip zones from user searches.
