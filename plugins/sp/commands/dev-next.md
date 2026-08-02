---
description: Status-aware router — pick and run the next best /sp:dev-* step for a task or feature frontier
argument-hint: "[<wbs|feature-id>] [--dry-run] [--once] [--auto] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [--full]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Next

Wraps the **sp:next-router** skill.

## Usage

/sp:dev-next [<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <name|auto>] [--inline|--subprocess] [--full]

## Implementation

- Apply and forward the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:next-router", args="$ARGUMENTS")`
