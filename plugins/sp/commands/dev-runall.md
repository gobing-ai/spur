---
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
argument-hint: "--tasks <selector> [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Runall

Wraps the **sp:spur-dev** skill (execution half — batch operation).

Run a **set** of task files through their pipelines in one operation, in dependency-correct order.
Where `/sp:dev-run <wbs>` runs one task through `config/workflows/task-pipeline.yaml`, `/sp:dev-runall`
runs N tasks through the same verbatim pipeline with set resolution, freeze, topological ordering,
failure policy, and a batch report layered on top by the skill. The default is sequential; parallel
mode is opt-in and only applies to an independent subset that passes the fan-out checks.

## When to use

- A feature's task batch is ready to execute end-to-end ("run all todo tasks in feature A1").
- A dependency-ordered sweep is needed ("run every `ready` task").
- The operator says "run the batch", "execute these tasks", or "runall todo".

Do **not** use for a single task — `/sp:dev-run <wbs>` is lighter and owns the single-task pipeline
contract.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--tasks <selector>` | The task set to run (required). See selector grammar below. | (required) |
| `--mode <sequential\|parallel>` | Batch execution mode. `sequential` runs the topo-ordered plan one task at a time. `parallel` first applies the `sp:parallel-execution` dependency/file-overlap/token-budget checks, then fans out only the safe independent subset. | `sequential` |
| `--keep-going` | On a failed task, skip its in-batch dependents and continue independents. Default halts on first failure. | off (stop-the-batch) |
| `--auto` | Skip the HITL approve gate on each per-task run (sets `profile=auto` in each pipeline's `--vars`). Propagates to every task in the batch. | off |
| `--agent <name\|auto>` | Pin the per-task step executor. Merged into each pipeline's `--vars.agent`. Omit (the default) → spawned `agent.run` steps use the configured default executor (`omp`). **`sp:super-coder` remains the batch orchestrator regardless of `--agent`** — the flag pins the step executor, not the orchestrator. | (configured default — `omp`) |
| `--json` | Emit the batch report as JSON (machine consumption). Off emits the markdown report to the transcript. | off |

### Selector grammar (`--tasks <value>`)

| Form | Example | Resolves to |
|---|---|---|
| Explicit WBS list | `--tasks 0040,0042,0051` | Exactly those tasks (comma-separated, order irrelevant — the driver re-orders by dependency). |
| Status pseudo-list | `--tasks todo` | Every task with that status via `spur task list --status todo --json`. Valid: `todo`, `backlog`, `wip`, `blocked`, `testing`. |
| Feature-scoped | `--tasks feature:A1` | Every task whose `feature_id` edge is A1 via `spur task list --feature A1 --json`. |
| `ready` | `--tasks ready` | Tasks in `todo`/`backlog` whose every `dependencies[]` entry resolves to `done`. Reports each excluded task with its unmet dependency. |
| *(unknown)* | `--tasks bogus` | Error: lists the valid forms and halts before running anything. |

Resolution happens **once, at kickoff** — the set is frozen and never re-queried mid-batch.

## Behavior

Thin wrapper: argument parsing and deterministic delegation route to the `sp:spur-dev` `runall`
operation. Set resolution, freeze, topological ordering, the per-task run loop, optional parallel
fan-out, failure policy, and report shape are owned by the skill's batch driver (documented in
[references/execution-batch.md](../skills/spur-dev/references/execution-batch.md)).

### `--agent` — the two-surface contract

`--agent` is a **pipeline** command on the batch surface (the batch drives N pipelines). The
dual-workflow FSM runs each stage as a subprocess; the calling agent cannot block on itself, so
"current agent" is **not expressible** here. The honest behaviors:

| Value | Behavior |
|---|---|
| *(omitted)* | Forward nothing — each per-task pipeline's spawned `agent.run` steps resolve to the configured default executor (`omp`). |
| `<name>` | Spawn that explicit agent — threaded to each per-task `vars.agent`. |
| `auto` | Resolve the current runtime to its canonical agent name and spawn that, in each per-task `vars.agent`. |

In all cases `sp:super-coder` is the batch orchestrator — it runs the loop in its own context and is
not replaced by `--agent`. See [cross-cutting.md](../skills/spur-dev/references/cross-cutting.md)
§ "Honor `--agent`" for the full two-surface contract.

## Implementation

Delegates to **sp:spur-dev** skill. `$ARGUMENTS` passes all flags through verbatim:

```
Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")
```

The skill reads [references/execution-batch.md](../skills/spur-dev/references/execution-batch.md)
and drives the batch driver loop, delegating to `sp:super-coder` as the orchestrator.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-dev`
  skill's `runall` operation directly, routing to `sp:super-coder` as the orchestrator.
