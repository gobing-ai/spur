---
name: sp-rule-scan
description: Discover recurring anti-patterns worth codifying as rules
disable-model-invocation: true
---

# Rule Scan

Wraps the **sp:spur-cli** skill.

## Usage

$sp-rule-scan [<path-or-glob>]

## Implementation

- Invoke the **sp:spur-cli** skill with args `rule scan $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:4a6b231df35e — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
