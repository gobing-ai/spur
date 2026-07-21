---
name: sp-dev-review
description: "Review code for a task or path — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. Triggers: \"review this\", \"check the code\", \"SECUA review\", \"dev review\", \"audit this\"."
disable-model-invocation: true
---

# Dev Review

Wraps the **sp:functional-review** and **sp:code-verification** and **sp:code-improvement** skills.

## Usage

$sp-dev-review [<wbs|path>] [--agent <name|auto>] [--focus <dims>] [--fix <none|blockers-first|all>] [--auto] [--next]

## Implementation

- Functional traceability: Invoke the **sp:functional-review** skill with args `<wbs> $ARGUMENTS`.
- SECUA quality review: Invoke the **sp:code-verification** skill with args `review $ARGUMENTS`.
- Architectural depth: Invoke the **sp:code-improvement** skill with args `<wbs|path> $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:c9c14bbed6a1 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
