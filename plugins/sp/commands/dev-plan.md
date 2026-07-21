---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto] [--design-approved]"
allowed-tools: ["Bash", "Read", "Write", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Usage

/sp:dev-plan "<description>" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto] [--design-approved]

## Implementation

- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`

