---
name: context-router
description: >
  Diagnose context bloat, repetition, noisy tool usage, and opportunities to turn
  repeated instructions into rules or skills. Trigger when the user asks to save
  tokens, reduce prompt drag, streamline workflows, or optimize long sessions.
---

# Context Router

This skill is for local context governance.

## Use this when
- the user wants to save context
- the conversation is getting noisy
- the same constraints keep getting repeated
- skills, MCP, or long outputs are adding drag
- the user asks how to keep OpenCode from getting bloated

## Workflow

1. Run:

`node scripts/context-budget.mjs --days 14`

2. Read:
- `.contextos/analysis/context-budget.json`
- `.contextos/guard/SESSION_GUARD.md`

3. Recommend exactly three actions.
Prefer these categories:
- promote a repeated instruction into `AGENTS.md`
- refresh or tighten the guard file
- split a repeatable workflow into a skill
- trim noisy long-form outputs from future sessions

## Guardrails
- do not claim exact token costs unless the data supports it
- speak in terms of likely context drag if exact token usage is unavailable
- prefer local file changes over new infrastructure
