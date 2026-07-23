---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill.

## Usage

/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]

## Implementation

- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`

