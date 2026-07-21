---
description: Survey a codebase (or module tree) for shallow modules and deepening opportunities — emit a ranked MARKDOWN candidate report that feeds the planning half; never auto-refactors
argument-hint: "[<module-path>] [--scope <all|<path>>] [--json]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Arch

Wraps the **sp:sys-architecture** skill.

## Usage

/sp:dev-arch [<module-path>] [--scope <all|<path>>] [--json]

## Implementation

- `Skill(skill="sp:sys-architecture", args="survey $ARGUMENTS")`

<!-- adapter:generated v1 snapshot:d11e505afcb3 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
