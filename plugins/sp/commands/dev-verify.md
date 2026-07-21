---
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
argument-hint: "<wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill.

## Usage

/sp:dev-verify <wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]

## Implementation

- `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

