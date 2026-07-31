---
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
argument-hint: "--tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Runall

Wraps the **sp:spur-dev** skill.

## Usage

```
/sp:dev-runall --tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]
```

Flags: `--tasks <selector>` (required — explicit WBS list, status pseudo-list, `feature:<id>`,
or `ready`), `--feature <id>` (sugar for `feature:<id>`), `--mode <sequential|parallel>`
(default `sequential`; `parallel` fans out a proven-independent subset — see
`execution-batch.md` § Parallel Execution), `--keep-going` (batch failure policy — skip a failed
task's in-batch dependents, continue independents; default halts on first failure), `--auto`
(sets `profile=auto` on each per-task run, skipping the HITL approve gate), `--agent <name|auto>`
(pipeline override merged into each per-task `vars.agent`; pins the step executor, not the
orchestrator), `--json` (emit the report as JSON), `--wrap` (trigger `wrapup-pipeline.yaml`
after the batch completes), `--continue` (resume from checkpoint — see below).

**No `--next` flag.** `dev-runall` drives the complete `task-pipeline.yaml` per task, so every
step `--next` could chain to is already inside the pipeline. `--next` is meaningful on
`dev-run` (two modes: full vs implement-only) and `dev-verifyall` (a verdict-triggered status
transition), but a no-op here. Adding it would either do nothing or redefine runall into
implement-only-then-chain — which is what `dev-refineall --next` already does and what
`dev-operations.md` warns is a token bomb. The asymmetry with `dev-run` is deliberate.

**Three orthogonal axes** (do not confuse): `--keep-going` = batch failure policy (does a
failure halt the batch or skip dependents?); `--continue` = resume from checkpoint (pick up an
interrupted batch); `--next` = per-task lifecycle chaining (advance status on a verdict —
dev-verify/dev-verifyall only). See `dev-operations.md` § runall for the full distinction.

## Implementation

- `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` → `sp:super-planner` agent
