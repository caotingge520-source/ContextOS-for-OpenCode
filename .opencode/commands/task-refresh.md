---
description: Refresh current task identity anchor and sync it into guard context
agent: build
---

Run:

!`node scripts/refresh-current-task.mjs`

Then:
1. Read `@.contextos/tasks/current-task.yaml`
2. Read `@.contextos/tasks/current-task.md`
3. Confirm domain/object/scope/durability with confidence and evidence
4. Confirm `@.contextos/guard/SESSION_GUARD.md` now includes the current task anchor block
