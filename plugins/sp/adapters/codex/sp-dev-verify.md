---
name: sp-dev-verify
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
disable-model-invocation: true
---

# Dev Verify

Wraps the **sp:code-verification** skill.

## Usage

$sp-dev-verify <wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]

## Implementation

- Invoke the **sp:code-verification** skill with args `verify $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:802e4d08ca85 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
