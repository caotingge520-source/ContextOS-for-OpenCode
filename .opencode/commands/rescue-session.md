---
description: Mirror recent session exports locally so they can be recovered later
agent: build
---

Run:

!`node scripts/rescue-session.mjs --max-count 20`

Then:
1. Read `@.contextos/rescue/index.md`
2. Read `@.contextos/tasks/current-task.yaml`
3. Tell the user how many sessions were mirrored
4. Point to the newest rescue snapshot and current task identity (domain/object/scope/durability)
5. Suggest whether `SESSION_GUARD.md` should be refreshed now
