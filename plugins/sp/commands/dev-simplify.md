---
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
argument-hint: "[<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

## Usage

/sp:dev-simplify [<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-simplification", args="$ARGUMENTS")`

