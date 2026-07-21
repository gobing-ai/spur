---
name: sp-dev-dogfood
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
disable-model-invocation: true
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

## Usage

$sp-dev-dogfood <testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]

## Implementation

- Invoke the **sp:dogfood-testing** skill with args `$ARGUMENTS`.

<!-- adapter:generated v1 snapshot:f9426da66296 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
