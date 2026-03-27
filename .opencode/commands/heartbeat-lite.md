---
description: Silent runtime health check for task/guard/journal/risk state
agent: build
---

Run:

!`node scripts/heartbeat-lite.mjs`

Then:
1. If output is `HEARTBEAT_OK`, stop (no extra transcript noise)
2. If output is `HEARTBEAT_WARN ...`, execute only the suggested minimal action
