---
description: Audit recent context waste and recommend the next three actions
agent: build
---

Run:

!`node scripts/context-budget.mjs --days 14`

Then:
1. Read `@.contextos/analysis/context-budget.json`
2. Explain the biggest sources of context drag
3. Recommend exactly three actions
4. Prefer actions in this order:
   - turn repeated instructions into `AGENTS.md`
   - refresh `SESSION_GUARD.md`
   - split repeatable workflows into skills
5. Keep the answer practical and short
