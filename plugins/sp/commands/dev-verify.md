---
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
requires: [cli:spur, local-fs]
role: reviewer
argument-hint: "[<wbs>] [--all] [--tasks <selector>] [--feature <id>] [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to verify. Exclusive with `--all`. | required unless `--all` |
| `--all` | Batch scope: verify every task in the resolved set, one verdict per task plus a batch summary (the former `/sp:dev-verify --all`). Exclusive with `<wbs>`. | off |
| `--tasks` `<selector>` | Batch selector. Requires `--all`. | — |
| `--feature` `<id>` | Batch selector sugar. Requires `--all`. | omitted |
| `--json` | Emit the batch report as structured JSON. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated worktree. Requires `--all`. | off |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing verification. | omit |
| `--fix` `<none\|blockers-first\|all>` | Auto-fix policy on findings. | none |
| `--focus` `<lens>` | Verification lens. | omitted |
| `--bdd` | Run BDD scenarios. | off |
| `--auto` | Skip objective HITL gates. | off |
| `--force` | Re-run even if already verified. | off |
| `--next` | Hand off to the next-router on success. | off |
| `--skip-shippable` | Compatibility alias for --skip-shipable; skip the shippable gate. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-verify <wbs> [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--skip-shippable]
```

**Shippable readiness** (feature-level): when `--fix all` and the task has a `feature_id`, the
skill runs `spur feature check <id> --as done --strict` after the per-task verdict and emits `Shippable: PASS|FAIL|N/A`.
Default **on** with `--fix all`. Opt out only with **`--skip-shippable`** (alias `--skip-shipable`).
See `sp:code-verification` § Shippable readiness gate.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- **Batch scope (`--all`, task 1390):** `--all` dispatches the former `dev-verify --all` operation —
  `Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS-without---all")`, whose inner per-task leg is
  `verify`, plus the same once-after-the-batch shippable gate. Every former `dev-verify --all` flag keeps its
  meaning; `--all` and `<wbs>` are mutually exclusive.
- Single task: `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

**Flags:**

`--next`: chain-to-completion with
propagation — on a PASS verdict, hand the task back to `sp:next-router` to advance and re-invoke
until done or a gate stops it. The `testing → done` transition is the chain's first hop. A PARTIAL
or FAIL verdict halts the chain (task stays `testing` as review-pending). **was: `--next` chain-ish (undefined formally).**
