---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
argument-hint: "<testee> [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

## Usage

/sp:dev-dogfood <testee> [--agent <name|auto>] [--inline|--subprocess] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")`

