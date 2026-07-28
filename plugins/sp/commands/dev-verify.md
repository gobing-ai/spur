---
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
argument-hint: "<wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--skip-shippable]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill.

## Usage

```
/sp:dev-verify <wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--skip-shippable]
```

**Shippable readiness** (feature-level): when `--fix all` and the task has a `feature_id`, the
skill runs `spur feature check <id>` after the per-task verdict and emits `Shippable: PASS|FAIL|N/A`.
Default **on** with `--fix all`. Opt out only with **`--skip-shippable`** (alias `--skip-shipable`).
See `sp:code-verification` § Shippable readiness gate.

## Implementation

- `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`
