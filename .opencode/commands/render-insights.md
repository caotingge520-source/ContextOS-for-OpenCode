---
description: Render local insights JSON + HTML from recent sessions
agent: build
---

Run:

!`node scripts/render-insights.mjs --days 30`

Then:
1. Read `@.contextos/analysis/insights.json`
2. Point to `@insights-report.html`
