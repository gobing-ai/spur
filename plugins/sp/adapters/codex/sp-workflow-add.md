---
name: sp-workflow-add
description: Author a validated, dry-run-verified workflow in the right execution mode
disable-model-invocation: true
---

# Workflow Add

Wraps the **sp:spur-cli** skill.

## Usage

$sp-workflow-add "<description>" [--kind <state-machine|transition-flow>] [--file <path>]

## Implementation

- Invoke the **sp:spur-cli** skill with args `workflow add $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:c228dbfe8147 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
