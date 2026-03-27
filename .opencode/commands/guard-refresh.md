---
description: Refresh the local SESSION_GUARD.md so important context survives compaction
agent: build
---

Read:
- `@templates/session-guard-template.md`
- `@.contextos/guard/SESSION_GUARD.md`
- `@.contextos/tasks/current-task.yaml`

Run first:

!`node scripts/refresh-current-task.mjs`
!`node scripts/snapshot-guard.mjs`

Update `.contextos/guard/SESSION_GUARD.md` using the template structure.

Requirements:
- preserve the `Manual notes` section if it already contains user-written content
- keep the file short and concrete
- capture current task, active files, decisions, constraints, and next 3 steps
- include current task identity fields: domain, object, scope, durability, confidence
- include the latest write-ahead snapshot metadata
- avoid vague summaries
