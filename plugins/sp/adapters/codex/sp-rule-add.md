---
name: sp-rule-add
description: Author a validated, smoke-tested constraint rule
disable-model-invocation: true
---

# Rule Add

Wraps the **sp:spur-cli** skill.

## Usage

$sp-rule-add "<description>" [--file <path>] [--preset <target>]

## Implementation

- Invoke the **sp:spur-cli** skill with args `rule add $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:22683578a8db — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
