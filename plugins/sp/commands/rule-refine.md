---
description: Refine a constraint rule or preset, then re-verify it
argument-hint: "<rule-file-or-preset> [--intent \"<goal>\"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Rule Refine

Wraps the **sp:spur-cli** skill.

## Usage

/sp:rule-refine <rule-file-or-preset> [--intent "<goal>"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]

## Implementation

- `Skill(skill="sp:spur-cli", args="rule refine $ARGUMENTS")`

<!-- adapter:generated v1 snapshot:8a030384bb9a — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
