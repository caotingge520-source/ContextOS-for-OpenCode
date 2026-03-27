# Current Situation

Generated at: 2026-03-24T16:06:34.514Z

## What we are doing
- refresh current task identity routing anchor
- refresh current task identity routing anchor

## Task identity
- domain: capability
- scope: L2
- durability: candidate
- object: named capability unit / insights

## Active files
- `.contextos/analysis/insights.json`（已更新：分析 25/35）
- `.contextos/analysis/context-budget.json`（已更新：扫描 19）
- `insights-report.html`

## Recent decisions
- 请求/上下文直接指向当前项目或仓库
- 识别到稳定能力单元: insights
- 证据不足以直接 durable，按 candidate 处理
- recentMessages=0 (fallback)
- repeatedInstructionCount=4

## Next steps
1. 逐批尝试 `node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000` 与 `node scripts/context-budget.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000`
2. 如果超时仍多，优先修复导出链路（先确认 `opencode export` CLI 的稳定性再考虑更改脚本）
3. 在可复核状态下执行 `/optimize-context`，并按建议把规则沉入 AGENTS 或 Skill

