---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
argument-hint: "--tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Usage

/sp:dev-verifyall --tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json]

## Implementation

- Batch orchestration: `Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS")`
- Per-task verification (inner): `Skill(skill="sp:code-verification", args="verify <wbs> $SHARED_FLAGS")`

