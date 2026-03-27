# ContextOS for OpenCode

A local-first control layer for OpenCode.

ContextOS for OpenCode is a free, MIT-licensed scaffold that helps you do three things without adding any cloud dependency:

1. **See how you actually use OpenCode** with a local `insights-report.html`
2. **Reduce context waste** with a context budget audit
3. **Protect long sessions** with a compacting guard file and rescue snapshots

This starter is designed to be dropped into a repo and then extended by OpenCode itself.

## Positioning (important)

- **OpenCode remains the main agent loop**.
- **ContextOS is a filesystem-driven state layer**, not a replacement harness.
- **Source of truth is local files**, so work can be recovered after crash/compaction.

## What is included

- `.opencode/commands/`
  - `/insights`
  - `/optimize-context`
  - `/rescue-session`
  - `/guard-refresh`
  - `/snapshot-guard`
  - `/rescue-latest`
  - `/budget-check`
  - `/heartbeat-lite`
  - `/render-insights`
  - `/continue-contextos`
  - `/intake-gate`
- `.opencode/skills/`
  - `insights`
  - `context-router`
  - `session-guard`
- `.opencode/plugins/contextos-guard.js`
  - injects `.contextos/guard/SESSION_GUARD.md` into compaction context
- `scripts/`
  - `generate-insights.mjs`
  - `context-budget.mjs`
  - `rescue-session.mjs`
  - `snapshot-guard.mjs`
  - `rescue-latest.mjs`
  - `budget-check.mjs`
  - `heartbeat-lite.mjs`
  - `intake-gate.mjs`
  - `render-insights.mjs`
  - `contextos-lib.mjs`
- `templates/`
  - `report-template.html`
  - `session-guard-template.md`
- `docs/`
  - architecture, roadmap, MVP

## Quick start

Unzip this into the root of the project you want to work on.

Then make sure `opencode` is available in your shell.

Run:

```bash
opencode
```

Inside OpenCode, try:

```text
/insights
/optimize-context
/budget-check
/guard-refresh
/snapshot-guard
/rescue-session
/rescue-latest
/heartbeat-lite
/render-insights
/continue-contextos
/intake-gate
```

You can also run the scripts directly:

```bash
node scripts/generate-insights.mjs --days 30
node scripts/context-budget.mjs --days 14
node scripts/budget-check.mjs --days 14
node scripts/rescue-session.mjs --max-count 20
node scripts/rescue-latest.mjs --max-count 20
node scripts/snapshot-guard.mjs
node scripts/heartbeat-lite.mjs
node scripts/intake-gate.mjs --mode auto --prompt "continue current task"
```

Optional flags (for stale/slow session exports):

```bash
node scripts/generate-insights.mjs --days 30 --max-export-attempts 24 --export-timeout-ms 8000
node scripts/context-budget.mjs --days 14 --max-export-attempts 24 --export-timeout-ms 8000
```

- `--max-export-attempts`: maximum number of sampled sessions to attempt export.
- `--export-timeout-ms`: per-export timeout in milliseconds.

For large history windows or slow environments, this project has stabilized around:

```bash
node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000
```

## What gets written

- `insights-report.html`
- `.contextos/analysis/insights.json`
- `.contextos/analysis/context-budget.json`
- `.contextos/analysis/context-budget-report.html`
- `.contextos/rescue/*.json`
- `.contextos/rescue/index.md`
- `.contextos/runtime/intake-decision.json`
- `.contextos/runtime/selected-context.json`
- `.contextos/runtime/selected-context.md`

## Task Intake Gate (Sprint 1)

`node scripts/intake-gate.mjs` is the runtime entrance for task intake before continuation.

It classifies each request into:

- `new_task`
- `continue_task`
- `pivot_task`
- `ambiguous`

Then it writes a **minimal selected context slice** (instead of dumping full SoT files):

- `.contextos/runtime/intake-decision.json` — mode, task identity, evidence, selected/excluded sources, recommended action
- `.contextos/runtime/selected-context.json` — structured selected context sections for automation
- `.contextos/runtime/selected-context.md` — human-readable selected context

Optional flags:

- `--mode auto|new_task|continue_task|pivot_task|ambiguous`
- `--max-sections <n>`
- `--max-chars <n>`
- `--apply` (only applies anchor updates for confident continue/pivot paths)

## Source of truth files

ContextOS now treats these as runtime state truth:

- `.contextos/tasks/current-task.yaml` — structured current task identity and next actions
- `.contextos/tasks/situation.md` — human-readable current situation snapshot
- `.contextos/guard/SESSION_GUARD.md` — compaction-safe guard with must-survive constraints
- `.contextos/rescue/latest/` — restore helper bundle (`restore-summary.md`, `latest-snapshot.json`, `continue-prompt.md`)
- `.contextos/journal/` — write-ahead state events
- `.contextos/memory/core.md` — core findings / durable knowledge

Guard and Rescue are designed to read these files first, then consult transcript exports only as secondary context.

## State chain (crash-recoverable)

1. `node scripts/refresh-current-task.mjs`
   - updates `current-task.yaml`, `current-task.md`, `situation.md`, `memory/core.md`
2. `node scripts/snapshot-guard.mjs`
   - writes write-ahead snapshot to `.contextos/guard/snapshots/`
3. `node scripts/rescue-latest.mjs --max-count 20`
   - writes rescue helper bundle under `.contextos/rescue/latest/`
4. `node scripts/heartbeat-lite.mjs`
   - returns `HEARTBEAT_OK` when healthy, otherwise minimal warning + one action

## Task Identity Routing

`insights-report.html` and `.contextos/analysis/insights.json` now include task identity routing outputs from `inferTaskIdentityRouting(...)`.

`insights.json` adds aggregated distribution fields under `counts`:

- `taskIdentityDomains`: routing domain frequencies (for example: insights, workflow, maintenance).
- `taskIdentityScopes`: scope frequencies (for example: file, module, project).
- `taskIdentityDurabilities`: expected persistence layer of the task (one_shot / iterative / ongoing / uncertain).
- `taskIdentityObjectTypes`: grouped object_type frequencies (for example: command, capability, file, text).
- `taskIdentityObjectNames`: top object names by frequency.

Each session record also contains `taskIdentity`:

- `domain`: coarse task domain.
- `object_type`: what entity the task is about.
- `object_name`: entity name extracted from request context.
- `scope`: operational scope.
- `durability`: likely lifespan or repeatability.
- `confidence`: numeric score from `0` to `1`.
- `evidence`: supporting evidence terms.

These fields make intent shifts easier to audit, and help route each analysis result to the right continuation path.

## Current scope

This starter deliberately stays local-first.

It does **not** do cross-device sync, hosted storage, or account management.

## Runtime risk gate (/optimize-context)

`node scripts/budget-check.mjs` (or `/optimize-context`) outputs explainable multi-category risk:

- `context_fade`
- `context_pollution`
- `knowledge_bottleneck`
- `context_overload`

Each category includes:

- `riskLevel`
- `score`
- `evidence`
- `recommendedAction`

## Known limitations

This starter reads session history through the documented OpenCode CLI surface:
- `opencode session list --format json`
- `opencode export <sessionID>`

OpenCode versions can change the exact JSON shape of exports over time. The parsers here are defensive, but you should treat them as a strong starter rather than a guaranteed forever-stable parser.

## Verify task identity quality

When validating routing output, focus on these checks:

- Confirm `insights.json` contains non-empty `counts.taskIdentity*` arrays.
- Confirm at least some items in `sessions[*].taskIdentity.confidence` are above `0.6` when context is clear.
- Inspect `sessions[*].taskIdentity.evidence` for readable, request-relevant signals.
- Open `insights-report.html` and ensure the four distribution charts are visible and populated.

Command checklist:

```bash
node --test
node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000
node scripts/context-budget.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000
```

If `insights-report.html` still shows placeholder text, re-run with the stable flags and check export failures in the command output.

## Suggested first build loop

1. Run `/insights`
2. Review the generated AGENTS patch suggestions
3. Run `/guard-refresh`
4. Let OpenCode implement the next roadmap item with `/continue-contextos`

## License

MIT
