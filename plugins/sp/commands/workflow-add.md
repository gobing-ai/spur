---
description: Author a validated, dry-run-verified workflow in the right execution mode
role: scribe
argument-hint: "\"<description>\" [--kind <state-machine|transition-flow>] [--file <path>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Workflow Add

Wraps the **sp:spur-cli** skill.

## Usage

/sp:workflow-add "<description>" [--kind <state-machine|transition-flow>] [--file <path>]

## Implementation

- `Skill(skill="sp:spur-cli", args="workflow add $ARGUMENTS")`

