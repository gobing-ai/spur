---
description: Refine an existing workflow, then re-validate and re-dry-run it
argument-hint: "<workflow-file> [--intent \"<goal>\"] [--dry-run]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Workflow Refine

Wraps the **sp:spur-cli** skill.

## Usage

/sp:workflow-refine <workflow-file> [--intent "<goal>"] [--dry-run]

## Implementation

- `Skill(skill="sp:spur-cli", args="workflow refine $ARGUMENTS")`

