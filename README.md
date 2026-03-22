# ContextOS for OpenCode

A local-first control layer for OpenCode.

ContextOS for OpenCode is a free, MIT-licensed scaffold that helps you do three things without adding any cloud dependency:

1. **See how you actually use OpenCode** with a local `insights-report.html`
2. **Reduce context waste** with a context budget audit
3. **Protect long sessions** with a compacting guard file and rescue snapshots

This starter is designed to be dropped into a repo and then extended by OpenCode itself.

## What is included

- `.opencode/commands/`
  - `/insights`
  - `/optimize-context`
  - `/rescue-session`
  - `/guard-refresh`
  - `/continue-contextos`
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
/guard-refresh
/rescue-session
/continue-contextos
```

You can also run the scripts directly:

```bash
node scripts/generate-insights.mjs --days 30
node scripts/context-budget.mjs --days 14
node scripts/rescue-session.mjs --max-count 20
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
- `.contextos/rescue/*.json`
- `.contextos/rescue/index.md`

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
