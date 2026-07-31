---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
argument-hint: "--tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Usage

```
/sp:dev-verifyall --tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]
```

Flags: `--tasks <selector>` (required unless `--feature`), `--feature <id>` (sugar for
`feature:<id>`), shared verify flags (`--agent`, `--fix`, `--focus`, `--bdd`, `--auto`, `--force`),
`--next` (per-task lifecycle chaining — see below), `--json`, `--skip-shippable`.

**`--next` (per-task lifecycle chaining):** for each task whose verdict is **PASS**, transition
`testing → done` through the FSM with the `--strict-core` Review L3 guard honored; a task whose
verdict is **PARTIAL** or **FAIL** does **not** transition (it stays `testing` as review-pending).
One task's non-PASS never blocks another task's transition — each task's verdict is its own.
Transitions run **before** the shippable gate (R3), so `spur feature check` observes the final
statuses. Do not confuse with `--keep-going` (batch failure policy, dev-runall) or `--continue`
(resume from checkpoint) — see the three-axis distinction in `dev-operations.md`.

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
