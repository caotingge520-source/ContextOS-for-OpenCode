---
name: insights
description: >
  Analyze recent OpenCode usage patterns, generate an interactive local HTML report,
  and extract repeatable rules, friction patterns, and workflow improvements.
  Trigger this when the user asks to analyze usage, generate an insights report,
  review recent sessions, inspect work habits, or find workflow bottlenecks.
---

# Insights

This skill reviews recent OpenCode sessions and turns them into a practical local report.

## When to use
Use this skill when the user asks to:
- analyze recent OpenCode habits
- generate an insights report
- inspect session history
- find workflow friction
- see repeated instructions
- improve AGENTS.md or CLAUDE.md based on actual usage

## Required workflow

### Step 1
Run:

`node scripts/generate-insights.mjs --days 30`

### Step 2
Read:
- `.contextos/analysis/insights.json`
- `insights-report.html`

### Step 3
Summarize:
- how many sessions were analyzed
- completion rate
- top friction types
- strongest repeated instruction candidates
- top quick wins

### Step 4
Recommend:
- which items belong in `AGENTS.md`
- which items should become reusable skills
- which habits are creating unnecessary context growth

## Output style
Keep the report summary concrete.
Do not just restate charts.
Translate repeated user behavior into usable rules.
