---
description: Mirror recent session exports locally so they can be recovered later
agent: build
---

Run:

!`node scripts/rescue-session.mjs --max-count 20`

Then:
1. Read `@.contextos/rescue/index.md`
2. Tell the user how many sessions were mirrored
3. Point to the newest rescue snapshot
4. Suggest whether `SESSION_GUARD.md` should be refreshed now
