---
description: Mirror recent session exports locally so they can be recovered later
agent: build
---

Run:

!`node scripts/rescue-latest.mjs --max-count 20`

Then:
1. Read `@.contextos/rescue/latest/restore-summary.md`
2. Read `@.contextos/rescue/latest/continue-prompt.md`
3. Read `@.contextos/rescue/latest/latest-snapshot.json`
4. Read `@.contextos/rescue/index.md`
5. Tell the user how many sessions were mirrored
6. Point to the newest rescue snapshot and current task identity (domain/object/scope/durability)
7. Suggest whether `SESSION_GUARD.md` should be refreshed now
