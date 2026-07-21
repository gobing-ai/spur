---
description: Author a validated, smoke-tested constraint rule
argument-hint: "\"<description>\" [--file <path>] [--preset <target>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Rule Add

Wraps the **sp:spur-cli** skill.

## Usage

/sp:rule-add "<description>" [--file <path>] [--preset <target>]

## Implementation

- `Skill(skill="sp:spur-cli", args="rule add $ARGUMENTS")`

<!-- adapter:generated v1 snapshot:22683578a8db — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
