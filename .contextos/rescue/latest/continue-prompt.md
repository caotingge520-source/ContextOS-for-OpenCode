# Continue Prompt

Use this state bundle as the source of truth before reading transcript history.

## What we are doing now
- refresh current task identity routing anchor
- refresh current task identity routing anchor

## What to open first
1. `.contextos/analysis/insights.json`（已更新：分析 25/35）
2. .contextos/tasks/situation.md
3. .contextos/guard/SESSION_GUARD.md

## Next action
- 逐批尝试 `node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000` 与 `node scripts/context-budget.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000`

## Must-carry constraints
- Stay local-first
- Do not add cloud sync
- Prefer reviewable patches over hidden automation
- 继续优先复用现有本地分析文件进行续航，不做空口承诺的状态更新

## Rescue pointers
- latest snapshot file: .contextos/rescue/ses_3aaf1fd39ffedSlBJY8vwdErzR.json
- restore summary: .contextos/rescue/latest/restore-summary.md
- latest state json: .contextos/rescue/latest/latest-snapshot.json

