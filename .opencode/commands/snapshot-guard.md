---
description: Write-ahead guard snapshot before risky actions
agent: build
---

Run:

!`node scripts/snapshot-guard.mjs`

Then:
1. Read `@.contextos/guard/snapshots/latest.json`
2. Confirm generatedAt, task identity, constraints, and next steps are present
3. Confirm `@.contextos/guard/SESSION_GUARD.md` has the latest snapshot section
