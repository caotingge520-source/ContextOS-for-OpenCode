# ContextOS for OpenCode

ContextOS for OpenCode is a local-first context operating system built on top of OpenCode.
OpenCode gets more powerful with use. ContextOS makes sure it doesn’t get more chaotic.

It helps heavy OpenCode users understand how they actually work, reduce context waste, protect long sessions from getting messy, and turn repeated instructions into reusable project rules.

Instead of building yet another AI shell, ContextOS focuses on a harder problem:

**how to make OpenCode get better with use, not worse.**

---

## Why this exists

As OpenCode usage gets heavier, the workflow often becomes more powerful but also more fragile.

More skills means more surface area.  
More MCP servers means more context pressure.  
Longer sessions mean more drift, more compaction risk, and more forgotten constraints.  
Repeated instructions pile up, but never become reusable system rules.

ContextOS for OpenCode exists to solve that layer.

It is designed as a local-first control layer for serious OpenCode workflows.

---

## What it does

ContextOS currently focuses on four things:

### 1. Insights
Analyze recent OpenCode session history and generate an interactive report:
- usage patterns
- friction points
- repeated instructions
- workflow suggestions
- AGENTS.md / CLAUDE.md optimization candidates

### 2. Rule Synthesis
Turn repeated user instructions into concrete rule patches:
- project-level `AGENTS.md` suggestions
- global instruction suggestions
- skill candidates for repeated workflows

### 3. Context Optimization
Show where context is being wasted and recommend actions:
- heavy skills
- oversized tool outputs
- repeated prompt patterns
- avoidable context load

### 4. Session Guard
Protect long-running work by preserving essential task state:
- task goal snapshot
- recent decisions
- working file hints
- rescue metadata for recovery flows

---

## Design principles

ContextOS follows a few simple principles:

- **local-first** — your analysis stays on your machine
- **workflow-first** — optimize how work gets done, not just token counts
- **gradual control** — suggest first, automate later
- **OpenCode-native** — build with OpenCode conventions instead of fighting them
- **human-readable outputs** — reports, patches, and rescue states should be understandable

---

## Core commands

The current starter version includes the following command entry points:

- `/insights`
- `/optimize-context`
- `/guard-refresh`
- `/rescue-session`
- `/continue-contextos`

---

## Project status

This project is currently in an early local-first alpha.

The current focus is:
1. session analysis
2. rule patch generation
3. context budget suggestions
4. lightweight session protection

Cross-device sync is intentionally out of scope for now.

---

## Roadmap

### Phase 1
- local session analysis
- HTML insights report
- AGENTS.md / CLAUDE.md patch generation

### Phase 2
- Router Lite
- context budget suggestions
- skill / MCP / output load recommendations

### Phase 3
- Session Guard improvements
- stronger compaction protection
- rescue and continuation workflows

---

## Who this is for

ContextOS is built for people who use OpenCode heavily enough to feel the real pain:

- long sessions
- repeated instructions
- prompt drift
- context bloat
- compaction fragility
- workflow inconsistency

If your OpenCode setup is starting to feel powerful but unstable, this project is for you.

---

## Installation

This repository is currently distributed as a local-first starter project.

Unzip into your project root, review the included files, and start with:

- `/insights`
- report generation
- rule patch review
- session guard refresh

Detailed setup instructions are in `START_HERE.md`.

---

## Philosophy

ContextOS is not trying to replace OpenCode.

It is trying to become the layer that helps OpenCode stay sharp, stable, and reusable as usage gets more complex.

The long-term goal is simple:

**Make OpenCode workflows more governable, more inspectable, and more resilient.**

---

## License

MIT
