---
description: Evaluate runtime context risk gate and produce action plan
agent: build
---

Run:

!`node scripts/budget-check.mjs --days 14`

Then:
1. Read `@.contextos/analysis/context-budget.json`
2. Mention risk category + level + evidence + recommended action for each category
3. Point to `@.contextos/analysis/context-budget-report.html`
