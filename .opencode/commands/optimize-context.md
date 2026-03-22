---
description: Audit recent context waste and recommend the next three actions
agent: build
---

Run:

!`node scripts/context-budget.mjs --days 14`

Then:
1. Read `@.contextos/analysis/context-budget.json`
2. Mention risk level, score, top 3 risk sources, and immediate action
3. Read `@.contextos/analysis/context-budget-report.html` when visual context is needed
4. Keep recommendation order practical: guard/rescue/summarize/scope/rules
5. Keep the answer practical and short
