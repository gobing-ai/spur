---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Usage

/sp:dev-run <wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next] [--wrap] [--continue]

## Implementation

- Full pipeline (default): `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`
- Implement step (`--next` or `--mode implement`): `Skill(skill="sp:code-implementation", args="$ARGUMENTS")`

<!-- adapter:generated v1 snapshot:335b55dcc3a4 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
