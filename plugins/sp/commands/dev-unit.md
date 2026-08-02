---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <inline|auto|name>] [[`--auto`](../skills/spur-dev/references/flag-glossary.md#flag-auto)]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Usage

/sp:dev-unit <target> [--coverage <n>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-testing", args="$ARGUMENTS")`
