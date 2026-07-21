---
name: sp-dev-run
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
disable-model-invocation: true
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Usage

$sp-dev-run <wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next] [--wrap] [--continue]

## Implementation

- Full pipeline (default): Invoke the **sp:spur-dev** skill with args `run $ARGUMENTS`.
- Implement step (`--next` or `--mode implement`): Invoke the **sp:code-implementation** skill with args `$ARGUMENTS`.

<!-- adapter:generated v1 snapshot:335b55dcc3a4 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
