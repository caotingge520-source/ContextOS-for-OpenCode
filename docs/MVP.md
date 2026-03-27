# MVP

## Core promise

ContextOS for OpenCode should make OpenCode feel more stable and more intentional, not more magical.

OpenCode remains the main loop.
ContextOS acts as a filesystem state layer for recovery and risk governance.

## MVP scope

### Must ship
- session analysis from local OpenCode history
- interactive HTML insights report
- repeated instruction extraction
- AGENTS patch suggestions
- runtime context risk gate (`/optimize-context`) with explainable evidence
- rescue snapshots + restore helper bundle (`restore-summary.md`, `latest-snapshot.json`, `continue-prompt.md`)
- write-ahead guard snapshots before risky actions
- compaction guard injection from local state files
- heartbeat-lite health check (`HEARTBEAT_OK` on healthy state)

### Nice to have
- better task classification
- richer tool usage breakdown
- confidence scores for friction classification
- AGENTS patch application helper

### Not yet
- remote memory
- team sync
- dashboards beyond local HTML
- heavy background daemons
- provider-specific metrics

## User journey

1. User runs `/task-refresh`
2. User runs `/snapshot-guard` before risky work
3. User runs `/optimize-context` to check four-category risk
4. User runs `/rescue-latest` for crash-recoverable helper artifacts
5. User runs `/heartbeat-lite` (returns `HEARTBEAT_OK` when healthy)
6. User continues session with lower context loss risk
