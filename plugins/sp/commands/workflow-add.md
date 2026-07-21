---
description: Author a validated, dry-run-verified workflow in the right execution mode
argument-hint: "\"<description>\" [--kind <state-machine|transition-flow>] [--file <path>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Workflow Add

Wraps the **sp:spur-cli** skill.

## Usage

/sp:workflow-add "<description>" [--kind <state-machine|transition-flow>] [--file <path>]

## Implementation

- `Skill(skill="sp:spur-cli", args="workflow add $ARGUMENTS")`

<!-- adapter:generated v1 snapshot:c228dbfe8147 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
