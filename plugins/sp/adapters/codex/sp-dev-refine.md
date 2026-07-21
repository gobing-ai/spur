---
name: sp-dev-refine
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
disable-model-invocation: true
---

# Dev Refine

Wraps the **sp:spur-dev** skill.

## Usage

$sp-dev-refine <wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]

## Implementation

- Invoke the **sp:spur-dev** skill with args `refine $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:1d1d6c827b51 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
