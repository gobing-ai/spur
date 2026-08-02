---
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
argument-hint: "[`--tasks`](../skills/spur-dev/references/flag-glossary.md#flag-tasks) <selector> [[`--feature`](../skills/spur-dev/references/flag-glossary.md#flag-feature) <id>] [[`--mode`](../skills/spur-dev/references/flag-glossary.md#flag-mode) <fan-out|review-panel|investigation>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [[`--json`](../skills/spur-dev/references/flag-glossary.md#flag-json)]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Parallel

Wraps the **sp:parallel-execution** skill.

## Usage

/sp:dev-parallel --tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--inline|--subprocess] [--json]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface) before choosing native subagents or `spur agent run`.
- `Skill(skill="sp:parallel-execution", args="$ARGUMENTS")`
