---
description: Reverse engineer a codebase with selectable depth, focus, and output format
argument-hint: "[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>]"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"]
---

# Dev Reverse

Wraps the **sp:reverse-engineering** skill.

## Usage

/sp:dev-reverse [<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>]

## Implementation

- `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")`

<!-- adapter:generated v1 snapshot:e31fac5fb6f6 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
