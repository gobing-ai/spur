---
name: sp-dev-simplify
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
disable-model-invocation: true
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

## Usage

$sp-dev-simplify [<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--auto]

## Implementation

- Invoke the **sp:code-simplification** skill with args `$ARGUMENTS`.

<!-- adapter:generated v1 snapshot:b88e22b38893 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
