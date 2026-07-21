---
name: sp-workflow-refine
description: Refine an existing workflow, then re-validate and re-dry-run it
disable-model-invocation: true
---

# Workflow Refine

Wraps the **sp:spur-cli** skill.

## Usage

$sp-workflow-refine <workflow-file> [--intent "<goal>"] [--dry-run]

## Implementation

- Invoke the **sp:spur-cli** skill with args `workflow refine $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:5cd4e41af4d7 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
