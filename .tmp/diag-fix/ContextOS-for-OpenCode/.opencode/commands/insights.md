---
description: Generate a local ContextOS insights report from recent OpenCode sessions
agent: build
---

Run this command sequence:

!`node scripts/generate-insights.mjs --days 30`

Then:
1. Read `@.contextos/analysis/insights.json`
2. Summarize the report in concise Chinese
3. Call out:
   - total sessions analyzed
   - completion rate
   - top 3 friction types
   - top 3 quick wins
4. Propose a small `AGENTS.md` patch, but do **not** apply it automatically
5. Point the user to `@insights-report.html`
