---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <name|auto>] [[`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto)]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Usage

/sp:dev-unit <target> [--coverage <n>] [--agent <name|auto>] [--auto]

## Implementation

- `Skill(skill="sp:code-testing", args="$ARGUMENTS")`

