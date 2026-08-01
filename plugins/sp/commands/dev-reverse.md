---
description: Reverse engineer a codebase with selectable depth, focus, and output format
argument-hint: "[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>] [[`--agent`](../skills/spur-dev/references/dev-operations.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/dev-operations.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/dev-operations.md#flag-subprocess)]"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Skill"]
---

# Dev Reverse

Wraps the **sp:reverse-engineering** skill.

## Usage

/sp:dev-reverse [<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>] [--agent <name|auto>] [--inline|--subprocess]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")`

