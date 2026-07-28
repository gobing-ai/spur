---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
argument-hint: "--tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json] [--skip-shippable]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Usage

```
/sp:dev-verifyall --tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json] [--skip-shippable]
```

**Shippable readiness** (feature-level): when `--fix all` and a feature context exists
(`--feature` or a unique shared `feature_id` across the set), after all per-task verifies the
orchestrator runs **one** `spur feature check <id>` and emits `Shippable: PASS|FAIL|N/A`.
A FAIL means the batch is **not clean** (rollup at least PARTIAL) even if every task AC PASSed.
Default **on** with `--fix all`. Opt out only with **`--skip-shippable`** (alias `--skip-shipable`).
Without `--fix all`, shippable is not evaluated (optional note: use `--fix all` for ship gate).

## Implementation

- Batch orchestration: `Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS")`
- Per-task verification (inner): `Skill(skill="sp:code-verification", args="verify <wbs> $SHARED_FLAGS")`
- Shippable gate: once after the batch (same skill § Shippable readiness gate)
