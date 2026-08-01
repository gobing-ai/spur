---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
argument-hint: "[`--tasks`](../skills/spur-dev/references/dev-operations.md#flag-tasks) <selector> [--feature <id>] [[`--agent`](../skills/spur-dev/references/dev-operations.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/dev-operations.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/dev-operations.md#flag-subprocess)] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Usage

```
/sp:dev-verifyall --tasks <selector> [--feature <id>] [--agent <name|auto>] [--inline|--subprocess] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]
```

Flags: `--tasks <selector>` (required unless [`--feature`](../skills/spur-dev/references/dev-operations.md#flag-feature)), `--feature <id>` (sugar for
`feature:<id>`), shared verify flags (`--agent`, [`--fix`](../skills/spur-dev/references/dev-operations.md#flag-fix),
[`--focus`](../skills/spur-dev/references/dev-operations.md#flag-focus), [`--bdd`](../skills/spur-dev/references/dev-operations.md#flag-bdd),
[`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto), [`--force`](../skills/spur-dev/references/dev-operations.md#flag-force)),
[`--next`](../skills/spur-dev/references/dev-operations.md#flag-next) (per-task lifecycle chaining — see below),
[`--json`](../skills/spur-dev/references/dev-operations.md#flag-json), [`--skip-shippable`](../skills/spur-dev/references/dev-operations.md#flag-skip-shippable).

**`--next` (per-task lifecycle chaining):** [`--next`](../skills/spur-dev/references/dev-operations.md#flag-next)
is chain-to-completion with propagation. For each task whose verdict is **PASS**, the chain's first
hop transitions `testing → done` through the FSM with the `--strict-core` Review L3 guard honored;
a task whose verdict is **PARTIAL** or **FAIL** does **not** transition (it stays `testing` as
review-pending) — that task's chain halts, reporting the verdict. One task's non-PASS never blocks
another task's transition — each task's verdict is its own, and each task's chain is independent.
Transitions run **before** the shippable gate (R3), so `spur feature check` observes the final
statuses. Do not confuse with [`--keep-going`](../skills/spur-dev/references/dev-operations.md#flag-keep-going)
(batch failure policy, dev-runall) or [`--continue`](../skills/spur-dev/references/dev-operations.md#flag-continue)
(resume from checkpoint) — see the glossary. **was: `--next` chain-ish (per-task transition, undefined formally).**

**Shippable readiness** (feature-level): when `--fix all` and a feature context exists
(`--feature` or a unique shared `feature_id` across the set), after all per-task verifies the
orchestrator runs **one** `spur feature check <id>` and emits `Shippable: PASS|FAIL|N/A`.
A FAIL means the batch is **not clean** (rollup at least PARTIAL) even if every task AC PASSed.
Default **on** with `--fix all`. Opt out only with **`--skip-shippable`** (alias `--skip-shipable`).
Without `--fix all`, shippable is not evaluated (optional note: use `--fix all` for ship gate).

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Batch orchestration: `Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS")`
- Per-task verification (inner): `Skill(skill="sp:code-verification", args="verify <wbs> $SHARED_FLAGS")`
- Shippable gate: once after the batch (same skill § Shippable readiness gate)
