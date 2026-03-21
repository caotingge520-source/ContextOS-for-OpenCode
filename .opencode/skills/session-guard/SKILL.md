---
name: session-guard
description: >
  Keep a compact local guard note so important task state survives long sessions and
  compaction. Trigger when the session is long, risky, multi-step, or nearing a
  compaction boundary.
---

# Session Guard

This skill keeps the durable session note current.

## Use this when
- a session is becoming long
- the work has multiple moving pieces
- a refactor or migration is in progress
- the user says not to lose current context
- the user is about to pause and resume later

## Workflow

1. Read:
- `templates/session-guard-template.md`
- `.contextos/guard/SESSION_GUARD.md`

2. Update `.contextos/guard/SESSION_GUARD.md` with:
- current task
- why it matters
- active files
- decisions made
- constraints that must survive compaction
- next 3 steps

3. Keep it short, factual, and reviewable.

## Important
The guard file exists to preserve continuity, not to become a second transcript.
