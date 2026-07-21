---
description: Status-aware router — pick and run the next best /sp:dev-* step for a task or feature frontier
argument-hint: "[<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <name|auto>] [--full]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Next

Wraps the **sp:next-router** skill.

## Usage

/sp:dev-next [<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <name|auto>] [--full]

## Implementation

- `Skill(skill="sp:next-router", args="$ARGUMENTS")`

