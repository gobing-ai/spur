---
name: sp-dev-parallel
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
disable-model-invocation: true
---

# Dev Parallel

Wraps the **sp:parallel-execution** skill.

## Usage

$sp-dev-parallel --tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]

## Implementation

- Invoke the **sp:parallel-execution** skill with args `$ARGUMENTS`.

<!-- adapter:generated v1 snapshot:8a4253231d50 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
