---
description: Run Task Intake Gate to classify task mode and load minimal runtime context slices
agent: build
---

Run:

!`node scripts/intake-gate.mjs --mode auto`

Then:
1. Read `@.contextos/runtime/intake-decision.json`
2. Read `@.contextos/runtime/selected-context.md`
3. Confirm intake mode, task identity, selectedSources, excludedSources, and recommended action
4. If ambiguous, ask one precise clarification before loading more context
