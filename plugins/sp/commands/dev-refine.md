---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill.

## Usage

/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]

## Implementation

- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`

<!-- adapter:generated v1 snapshot:1d1d6c827b51 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
