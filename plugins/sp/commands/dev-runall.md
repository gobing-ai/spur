---
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
argument-hint: "--tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <inline|auto|name>] [--json] [--wrap] [--next] [--continue] [--worktree]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Runall

Wraps the **sp:spur-dev** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks` `<selector>` | Task selector to run. | required |
| `--feature` `<id>` | Restrict to a feature. | omitted |
| `--mode` `<sequential\|parallel>` | Batch execution order. | sequential |
| `--keep-going` | Continue past per-task failures. | off |
| `--auto` | Skip objective HITL gates. | off |
| `--agent` `<inline\|auto\|name>` | Who runs each task's pipeline stages. Each per-task workflow's `agent.run` stages always dispatch a subprocess; `inline` is accepted there as a synonym for omit, resolving to `agent.default` (ADR-047). `auto` tier-resolves an executor; a name pins that executor. | agent.default |
| `--json` | Emit structured JSON. | off |
| `--wrap` | Run the wrap hop per task. | off |
| `--next` | Chain-to-completion via the next-router. | off |
| `--continue` | Resume an interrupted batch. | off |
| `--worktree` | Run the batch in an isolated git worktree; FF-merge on success, retain on failure. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-runall --tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <inline|auto|name>] [--json] [--wrap] [--next] [--continue] [--worktree]
```

Flags: `--tasks <selector>` (required — explicit WBS list, status pseudo-list, `feature:<id>`,
or `ready`), `--feature <id>` (sugar for `feature:<id>`), `--mode`
`<sequential|parallel>` (default `sequential`; `parallel` fans out a proven-independent subset —
see `execution-batch.md` § Parallel Execution), `--keep-going`
(batch failure policy — skip a failed task's in-batch dependents, continue independents; default
halts on first failure), `--auto`
(sets `profile=auto` on each per-task run, skipping the HITL approve gate), `--agent <inline|auto|name>`
(names who runs the pipeline's stages — merged into each per-task `vars.agent`; `inline` is accepted
there as a synonym for omit, resolving to `agent.default`, ADR-047; the orchestrator loop continues in this session), `--json` (emit the
report as JSON), `--wrap` (trigger
`wrapup-pipeline.yaml` after the batch completes), `--next`
(chain each task to terminal status, then run the wrap hop **once for the batch** — see below),
`--continue` (resume from checkpoint), `--worktree` (run the batch in an isolated git worktree —
FF-merge onto the base ref on full success, retain intact on any failure/halt/non-FF; see
`execution-batch.md` § Worktree isolation).

**`--worktree` is sequential-only.** `--worktree --mode parallel` is **rejected**. This flag gives
the batch *one* worktree for the whole run; per-task worktrees and parallel isolation remain task
0142 Slice A. Run parallel batches without `--worktree`, or run them sequentially with it.

**`--worktree` corpus visibility.** While the batch runs in a worktree, corpus writes (task
statuses, kanban) land in the worktree copy; your main tree still shows pre-run statuses until the
FF-merge on success. This is expected, not a bug.

**`--next` (batch-once wrap).** `--next`
is chain-to-completion with propagation. On `dev-runall`, each task in the batch runs its
`task-pipeline.yaml` to terminal status (the pipeline already drives precheck → implement → test →
review → approve → verify → record → done); when the batch is complete, the wrap hop runs **once
for the batch** — mirroring the batch-once shippable gate `dev-verifyall` uses — rather than once
per task. Without `--next`, `--wrap` is wrap-without-chaining (the single batch wraps without
advancing the feature lifecycle). **was: `--next` deliberately omitted; the old no-`--next` rationale argued against the old per-task-transition meaning and does not carry.**

**Three orthogonal axes** (do not confuse): `--keep-going`
= batch failure policy (does a failure halt the batch or skip dependents?);
`--continue` = resume from
checkpoint (pick up an interrupted batch); `--next`
= chain each task to terminal status + batch-once wrap. See `dev-operations.md` § runall for the
full distinction.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface). The orchestrator starts inline; each full per-task workflow retains its explicit subprocess boundary.
- `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` → `sp:super-planner` agent
