---
name: Next.js preview origins
description: Recognize blocked development resources behind the shared preview proxy.
---

A server-rendered dashboard loading skeleton that never hydrates can be a
development-origin restriction, not an authentication bug.

**Why:** newer Next.js development versions block cross-origin development
resources by default. Behind the preview proxy, HTML can render successfully
while development resources/HMR are blocked, leaving the initial skeleton
visible. A successful production build does not detect this.

**How to apply:** inspect the development workflow's blocked-origin messages
and browser network failures before rewriting auth. Allow the current preview
hostname explicitly for development; do not disable origin checks globally.
