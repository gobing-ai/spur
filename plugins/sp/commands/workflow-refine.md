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

<!-- adapter:generated v1 snapshot:5cd4e41af4d7 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
