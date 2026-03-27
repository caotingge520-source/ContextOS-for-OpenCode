# Session Guard

## Current task
- refresh current task identity routing anchor
## Why this matters
- Keep the active goal visible across long sessions and compaction
- 在长会话中保留可执行目标，避免“执行中断”导致上下文丢失

## Active files
- `.contextos/analysis/insights.json`（已更新：分析 25/35）
- `.contextos/analysis/context-budget.json`（已更新：扫描 19）
- `insights-report.html`
## Decisions made
- `.contextos/analysis/insights.json` 成功重写，时间窗与目标会话为 `2026-02-05 ~ 2026-02-13`
- 在长链路复跑中确认：`opencode export` 约需 10~11 秒，默认超时导致大量 `spawnSync ... ETIMEDOUT`
- 已确认 `--export-timeout-ms 22000`、`--max-export-attempts 35` 能提升覆盖率，当前仍有 10 个 session 受限于导出失败
- 已确认“Continue if you have next steps” 与“把重复流程拆成 skill”等为高频重复指令

## Constraints that must survive compaction
- Stay local-first
- Do not add cloud sync
- Prefer reviewable patches over hidden automation
- 继续优先复用现有本地分析文件进行续航，不做空口承诺的状态更新
## Next 3 steps
1. 逐批尝试 `node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000` 与 `node scripts/context-budget.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000`
2. 如果超时仍多，优先修复导出链路（先确认 `opencode export` CLI 的稳定性再考虑更改脚本）
3. 在可复核状态下执行 `/optimize-context`，并按建议把规则沉入 AGENTS 或 Skill
## Current task anchor
- title: refresh current task identity routing anchor
- domain: capability
- scope: L2
- durability: candidate
- confidence: 0.9
- object: named capability unit / insights
## State snapshot metadata
- generatedAt: 2026-03-24T16:06:34.513Z
- task title: refresh current task identity routing anchor
- domain/scope/durability: capability/L2/candidate
- active files: 3
- next steps: 3
## Recent decisions
- 请求/上下文直接指向当前项目或仓库
- 识别到稳定能力单元: insights
- 证据不足以直接 durable，按 candidate 处理
- recentMessages=0 (fallback)
- repeatedInstructionCount=4
## Last write-ahead snapshot
- generatedAt: 2026-03-24T16:06:34.554Z
- snapshot: .contextos/guard/snapshots/2026-03-24T16-06-34-554Z.json
- task: refresh current task identity routing anchor
- identity: capability/L2/candidate
