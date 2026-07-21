---
name: sp-dev-plan
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create
disable-model-invocation: true
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Usage

$sp-dev-plan "<description>" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto] [--design-approved]

## Implementation

- Invoke the **sp:spur-dev** skill with args `plan $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:7a1b2d64cd95 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
