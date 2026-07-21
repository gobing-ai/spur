---
name: sp-dev-unit
description: Generate or extend tests until the unit target is met
disable-model-invocation: true
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Usage

$sp-dev-unit <target> [--coverage <n>] [--agent <name|auto>] [--auto]

## Implementation

- Invoke the **sp:code-testing** skill with args `$ARGUMENTS`.

<!-- adapter:generated v1 snapshot:d1b7b042b0f7 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
