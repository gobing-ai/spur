---
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
argument-hint: "--tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Parallel

Wraps the **sp:parallel-execution** skill.

## Usage

/sp:dev-parallel --tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]

## Implementation

- `Skill(skill="sp:parallel-execution", args="$ARGUMENTS")`

<!-- adapter:generated v1 snapshot:8a4253231d50 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
