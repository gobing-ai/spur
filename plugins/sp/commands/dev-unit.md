---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <name|auto>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Usage

/sp:dev-unit <target> [--coverage <n>] [--agent <name|auto>] [--auto]

## Implementation

- `Skill(skill="sp:code-testing", args="$ARGUMENTS")`

<!-- adapter:generated v1 snapshot:d1b7b042b0f7 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
