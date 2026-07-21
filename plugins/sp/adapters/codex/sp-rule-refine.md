---
name: sp-rule-refine
description: Refine a constraint rule or preset, then re-verify it
disable-model-invocation: true
---

# Rule Refine

Wraps the **sp:spur-cli** skill.

## Usage

$sp-rule-refine <rule-file-or-preset> [--intent "<goal>"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]

## Implementation

- Invoke the **sp:spur-cli** skill with args `rule refine $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:8a030384bb9a — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
