---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [[`--agent`](../skills/spur-dev/references/dev-operations.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/dev-operations.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/dev-operations.md#flag-subprocess)] [[`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto)]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Usage

/sp:dev-unit <target> [--coverage <n>] [--agent <name|auto>] [--inline|--subprocess] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-testing", args="$ARGUMENTS")`
