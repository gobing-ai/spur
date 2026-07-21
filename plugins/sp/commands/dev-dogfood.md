---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
argument-hint: "<testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

## Usage

/sp:dev-dogfood <testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]

## Implementation

- `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")`

