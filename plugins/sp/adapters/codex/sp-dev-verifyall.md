---
name: sp-dev-verifyall
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
disable-model-invocation: true
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Usage

$sp-dev-verifyall --tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json]

## Implementation

- Batch orchestration: Invoke the **sp:spur-dev** skill with args `verifyall $ARGUMENTS`.
- Per-task verification (inner): Invoke the **sp:code-verification** skill with args `verify <wbs> $SHARED_FLAGS`.

<!-- adapter:generated v1 snapshot:03a333426bc2 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
