---
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
argument-hint: "[<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

## Usage

/sp:dev-simplify [<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--auto]

## Implementation

- `Skill(skill="sp:code-simplification", args="$ARGUMENTS")`

