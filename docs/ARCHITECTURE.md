# Architecture

## Overview

ContextOS is a **filesystem state OS** under the OpenCode loop:

- OpenCode = main agent loop and tool execution harness
- ContextOS = state persistence / restore / risk gate layer

Core layers:

1. **Commands (OpenCode entrypoints)**
2. **Scripts (local Unix-first state operations)**
3. **State files (source of truth)**
4. **Guard plugin (inject durable state during compaction)**

## Source of truth

- `.contextos/tasks/current-task.yaml`
- `.contextos/tasks/situation.md`
- `.contextos/guard/SESSION_GUARD.md`
- `.contextos/rescue/latest/`
- `.contextos/journal/`
- `.contextos/memory/core.md`

Guard and Rescue should read these files first, then transcript exports.

## Data flow

### Insights
1. `opencode session list --format json`
2. `opencode export <sessionID>` for sampled sessions
3. heuristics run in `scripts/generate-insights.mjs`
4. output goes to:
   - `.contextos/analysis/insights.json`
   - `insights-report.html`

### Context budget / risk gate
1. recent sessions are scanned
2. risk gate evaluates four categories:
   - `context_fade`
   - `context_pollution`
   - `knowledge_bottleneck`
   - `context_overload`
3. output goes to:
   - `.contextos/analysis/context-budget.json`
   - `.contextos/analysis/context-budget-report.html`

### Rescue
1. recent sessions are exported
2. raw exports are mirrored into `.contextos/rescue/`
3. restore helper bundle is generated in `.contextos/rescue/latest/`:
   - `restore-summary.md`
   - `latest-snapshot.json`
   - `continue-prompt.md`
4. index markdown is generated

### Guard
1. user refreshes current task and writes guard snapshot
2. write-ahead snapshot lands in `.contextos/guard/snapshots/`
3. `contextos-guard.js` injects guard/task state during compaction

### Heartbeat-lite
1. checks task anchor existence
2. checks guard snapshot freshness
3. checks journal flush state
4. checks context risk level
5. outputs `HEARTBEAT_OK` when healthy; otherwise minimal warning/action

## Why this shape

This starter intentionally uses the documented OpenCode extension surface instead of private internals:
- commands
- skills
- plugins
- custom local files
- CLI export/session APIs

## Future extension points

- replace heuristic task classification with a model-assisted classifier
- add a proper AGENTS patch applier
- add richer session diffing
- add per-project baselines and regression alerts
