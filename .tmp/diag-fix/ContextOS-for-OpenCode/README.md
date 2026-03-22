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

## What gets written

- `insights-report.html`
- `.contextos/analysis/insights.json`
- `.contextos/analysis/context-budget.json`
- `.contextos/rescue/*.json`
- `.contextos/rescue/index.md`

## Current scope

This starter deliberately stays local-first.

It does **not** do cross-device sync, hosted storage, or account management.

## Known limitations

This starter reads session history through the documented OpenCode CLI surface:
- `opencode session list --format json`
- `opencode export <sessionID>`

OpenCode versions can change the exact JSON shape of exports over time. The parsers here are defensive, but you should treat them as a strong starter rather than a guaranteed forever-stable parser.

## Suggested first build loop

1. Run `/insights`
2. Review the generated AGENTS patch suggestions
3. Run `/guard-refresh`
4. Let OpenCode implement the next roadmap item with `/continue-contextos`

## License

MIT
