---
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
argument-hint: "[`--tasks`](../skills/spur-dev/references/dev-operations.md#flag-tasks) <selector> [[`--feature`](../skills/spur-dev/references/dev-operations.md#flag-feature) <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [[`--agent`](../skills/spur-dev/references/dev-operations.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/dev-operations.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/dev-operations.md#flag-subprocess)] [--json] [--wrap] [--next] [--continue]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Runall

Wraps the **sp:spur-dev** skill.

## Usage

```
/sp:dev-runall --tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--inline|--subprocess] [--json] [--wrap] [--next] [--continue]
```

Flags: `--tasks <selector>` (required — explicit WBS list, status pseudo-list, `feature:<id>`,
or `ready`), `--feature <id>` (sugar for `feature:<id>`), [`--mode`](../skills/spur-dev/references/dev-operations.md#flag-mode)
`<sequential|parallel>` (default `sequential`; `parallel` fans out a proven-independent subset —
see `execution-batch.md` § Parallel Execution), [`--keep-going`](../skills/spur-dev/references/dev-operations.md#flag-keep-going)
(batch failure policy — skip a failed task's in-batch dependents, continue independents; default
halts on first failure), [`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto)
(sets `profile=auto` on each per-task run, skipping the HITL approve gate), `--agent <name|auto>`
(pipeline override merged into each per-task `vars.agent`; pins the step executor, not the
orchestrator), [`--json`](../skills/spur-dev/references/dev-operations.md#flag-json) (emit the
report as JSON), [`--wrap`](../skills/spur-dev/references/dev-operations.md#flag-wrap) (trigger
`wrapup-pipeline.yaml` after the batch completes), [`--next`](../skills/spur-dev/references/dev-operations.md#flag-next)
(chain each task to terminal status, then run the wrap hop **once for the batch** — see below),
[`--continue`](../skills/spur-dev/references/dev-operations.md#flag-continue) (resume from checkpoint).

**`--next` (batch-once wrap).** [`--next`](../skills/spur-dev/references/dev-operations.md#flag-next)
is chain-to-completion with propagation. On `dev-runall`, each task in the batch runs its
`task-pipeline.yaml` to terminal status (the pipeline already drives precheck → implement → test →
review → approve → verify → record → done); when the batch is complete, the wrap hop runs **once
for the batch** — mirroring the batch-once shippable gate `dev-verifyall` uses — rather than once
per task. Without `--next`, `--wrap` is wrap-without-chaining (the single batch wraps without
advancing the feature lifecycle). **was: `--next` deliberately omitted; the old no-`--next` rationale argued against the old per-task-transition meaning and does not carry.**

**Three orthogonal axes** (do not confuse): [`--keep-going`](../skills/spur-dev/references/dev-operations.md#flag-keep-going)
= batch failure policy (does a failure halt the batch or skip dependents?);
[`--continue`](../skills/spur-dev/references/dev-operations.md#flag-continue) = resume from
checkpoint (pick up an interrupted batch); [`--next`](../skills/spur-dev/references/dev-operations.md#flag-next)
= chain each task to terminal status + batch-once wrap. See `dev-operations.md` § runall for the
full distinction.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface). The orchestrator starts inline; each full per-task workflow retains its explicit subprocess boundary.
- `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` → `sp:super-planner` agent
