---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
role: reviewer
argument-hint: "--tasks <selector> [--feature <id>] [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** and **sp:code-verification** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks` `<selector>` | Task selector to verify. | required |
| `--feature` `<id>` | Restrict to a feature. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs each verification. | inline |
| `--fix` `<none\|blockers-first\|all>` | Auto-fix policy on findings. | none |
| `--focus` `<lens>` | Verification lens. | omitted |
| `--bdd` | Run BDD scenarios. | off |
| `--auto` | Skip objective HITL gates. | off |
| `--force` | Re-run even if already verified. | off |
| `--next` | Hand off to the next-router on success. | off |
| `--json` | Emit structured JSON. | off |
| `--skip-shippable` | Compatibility alias for --skip-shipable; skip the shippable gate. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-verifyall --tasks <selector> [--feature <id>] [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable] [--worktree [<name>]]
```

Flags: `--tasks <selector>` (required unless `--feature`), `--feature <id>` (sugar for
`feature:<id>`), shared verify flags (`--agent`, `--fix`,
`--focus`, `--bdd`,
`--auto`, `--force`),
`--next` (per-task lifecycle chaining — see below),
`--json`, `--skip-shippable`, `--worktree` `[<name>]` (run the batch in an isolated git worktree — FF-merge
onto the base ref on full success, retain intact on any failure/halt/non-FF; bare form creates a
fresh tree, `<name>` form adopts an existing worktree by name/path/branch; see
`execution-batch.md` § Worktree isolation).
**`--worktree` corpus visibility.** While the batch runs in a worktree, corpus writes (task
statuses, verdicts) land in the worktree copy; your main tree still shows pre-run statuses until
the FF-merge on success. Expected, not a bug.

**`--next` (per-task lifecycle chaining):** `--next`
is chain-to-completion with propagation. For each task whose verdict is **PASS**, the chain's first
hop transitions `testing → done` through the FSM with the `--strict-core` Review L3 guard honored;
a task whose verdict is **PARTIAL** or **FAIL** does **not** transition (it stays `testing` as
review-pending) — that task's chain halts, reporting the verdict. One task's non-PASS never blocks
another task's transition — each task's verdict is its own, and each task's chain is independent.
Transitions run **before** the shippable gate (R3), so `spur feature check` observes the final
statuses. Do not confuse with `--keep-going`
(batch failure policy, dev-runall) or `--continue`
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
