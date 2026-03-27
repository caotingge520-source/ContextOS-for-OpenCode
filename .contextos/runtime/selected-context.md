# Selected Context Slice

Generated at: 2026-03-26T14:14:43.858Z
Intake mode: new_task
Task identity: capability / insights / L2 / candidate
Confidence: 0.9

## Current Task Anchor
- title: refresh current task identity routing anchor
- summary: 继续优化当前任务的导出链路，先分析失败模式并修复
- domain: capability
- object: named capability unit / insights
- scope: L2
- durability: candidate

## Situation Summary
- preview:
  - # Current Situation
  - Generated at: 2026-03-24T16:06:34.514Z
  - ## What we are doing
  - - refresh current task identity routing anchor
  - - refresh current task identity routing anchor
  - ## Task identity
  - - domain: capability
  - - scope: L2
  - - durability: candidate
  - - object: named capability unit / insights
  - ## Active files
  - - `.contextos/analysis/insights.json`（已更新：分析 25/35）
  - - `.contextos/analysis/context-budget.json`（已更新：扫描 19）
  - - `insights-report.html`

## Must-Survive Constraints
- constraints:
  - Stay local-first
  - Do not add cloud sync
  - Prefer reviewable patches over hidden automation
  - 继续优先复用现有本地分析文件进行续航，不做空口承诺的状态更新

## Fresh Guard Snapshot Summary
- (not selected)

## Relevant Rescue Readiness
- generatedAt: 2026-03-24T16:08:09.374Z
- recommendedOpenFile: `.contextos/analysis/insights.json`（已更新：分析 25/35）
- nextAction: 逐批尝试 `node scripts/generate-insights.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000` 与 `node scripts/context-budget.mjs --days 45 --max-count 120 --max-export-attempts 35 --export-timeout-ms 22000`

## Relevant Capability Notes
- (not selected)

## Global Preferences (only if relevant)
- (not selected)

## Recommended Next Step
- action: 先 refresh guard，再进入本轮任务

## Selected Sources
- current_task_anchor: primary anchor for task identity and next steps
- must_survive_constraints: constraints must survive regardless of task mode
- relevant_rescue_readiness: high risk mode loads rescue helper for recoverability
- risk_gate_signal: intake should respect latest risk gate output
- situation_summary: kept as minimal situational context

## Excluded Sources
- (none)
