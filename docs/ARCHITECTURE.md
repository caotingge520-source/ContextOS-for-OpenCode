# Architecture

## Overview

ContextOS for OpenCode is made of four thin layers:

1. **Commands**
   - user-visible entry points inside OpenCode
2. **Skills**
   - prompt-level behavior routing
3. **Scripts**
   - local analyzers that read OpenCode CLI output
4. **Guard plugin**
   - injects durable context during compaction

## Data flow

### Insights
1. `opencode session list --format json`
2. `opencode export <sessionID>` for sampled sessions
3. heuristics run in `scripts/generate-insights.mjs`
4. output goes to:
   - `.contextos/analysis/insights.json`
   - `insights-report.html`

### Context budget
1. recent sessions are scanned
2. long transcripts and repetition are flagged
3. output goes to:
   - `.contextos/analysis/context-budget.json`

### Rescue
1. recent sessions are exported
2. raw exports are mirrored into `.contextos/rescue/`
3. an index markdown file is generated

### Guard
1. user refreshes `.contextos/guard/SESSION_GUARD.md`
2. `contextos-guard.ts` injects it during compaction

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
