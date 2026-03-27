---
description: Build latest restore helper bundle from source-of-truth files
agent: build
---

Run:

!`node scripts/rescue-latest.mjs --max-count 20`

Then:
1. Read `@.contextos/rescue/latest/restore-summary.md`
2. Read `@.contextos/rescue/latest/continue-prompt.md`
3. Read `@.contextos/rescue/latest/latest-snapshot.json`
4. Confirm current task, next action, and must-survive constraints are explicit
