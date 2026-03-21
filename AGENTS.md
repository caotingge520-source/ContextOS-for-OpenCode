# ContextOS for OpenCode

This repository builds a local-first control layer for OpenCode.

The product goal is simple:
- help the user understand how they use OpenCode
- reduce context waste
- preserve continuity across long sessions and compaction
- stay free, local-first, and easy to extend

## Product modules

### 1. Insights
Generate a local HTML report from recent OpenCode sessions.

Deliverables:
- `insights-report.html`
- `.contextos/analysis/insights.json`
- repeated instruction candidates
- AGENTS patch suggestions
- friction pattern summaries

### 2. Router Lite
Surface context bloat signals and recommend specific next actions.

Deliverables:
- `.contextos/analysis/context-budget.json`
- a concise terminal summary
- suggestions like:
  - move a repeated instruction into `AGENTS.md`
  - split a workflow into a skill
  - summarize a long result instead of carrying full output forward
  - refresh the session guard before continuing

### 3. Session Guard
Maintain a short durable note that survives compaction.

Files:
- `.contextos/guard/SESSION_GUARD.md`
- `.opencode/plugins/contextos-guard.js`

### 4. Session Rescue
Mirror recent session exports locally so the user can recover intent even if session UI loading is flaky.

Deliverables:
- `.contextos/rescue/*.json`
- `.contextos/rescue/index.md`

## Engineering principles

- default to local files
- avoid external services
- prefer zero dependencies
- do not silently apply risky changes
- generate reviewable patches instead of magical hidden mutations
- keep report output stable and human-readable
- preserve backward compatibility of analysis JSON when possible

## Coding conventions

- use plain ESM JavaScript unless TypeScript is clearly worth it
- prefer small pure helper functions in `scripts/contextos-lib.mjs`
- avoid framework lock-in
- never assume one fixed OpenCode export JSON shape
- keep heuristics explicit and easy to tweak

## What OpenCode should do when continuing work

When asked to continue building this project:
1. read `README.md`, `docs/MVP.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`
2. choose the next unfinished high-leverage task
3. make a small but real implementation
4. update docs if the contract changed
5. keep everything local-first

## Non-goals for now

- cross-device sync
- SaaS backend
- account systems
- paid tiers
- trying to replace OpenCode itself
