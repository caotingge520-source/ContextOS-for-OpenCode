---
description: Audit recent context waste and recommend the next three actions
agent: build
---

Run:

!`node scripts/budget-check.mjs --days 14`

Then:
1. Read `@.contextos/analysis/context-budget.json`
2. Mention risk level, score, risk category, top 3 risk sources, and immediate action
3. Read `@.contextos/analysis/context-budget-report.html` when visual context is needed
4. Include four category risks (`context_fade`, `context_pollution`, `knowledge_bottleneck`, `context_overload`) with evidence and action
5. Keep recommendation order practical: guard/rescue/summarize/scope/rules
6. Keep the answer practical and short
