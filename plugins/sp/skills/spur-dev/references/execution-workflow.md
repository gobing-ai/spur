---
name: execution-workflow
description: "Extracted section: the execution half — task selection → pipeline run → HITL surfacing → continue. How operations SEQUENCE in the task pipeline; per-operation definitions live in dev-operations.md, not here."
see_also:
  - spur-dev
  - dev-operations
---

# Execution Workflow

```
pick task (spur task list --json)
  → spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
  → on HITL pause: surface to operator → spur workflow continue [run-id] [--yes]
```

The execution half runs a single task through the `task-pipeline.yaml` workflow. The
pipeline drives the work; the skill interprets results, surfaces HITL gates, and decides
next steps.

This file owns **how operations sequence** in the pipeline. What each operation *does*
(`implement`, `unit`, `review`, `verify`) is defined once in
[dev-operations.md](dev-operations.md) — this file links to it rather than restating it.

> **`/sp:dev-run` drives the pipeline — it is NEVER a pipeline step.** The command
> `/sp:dev-run <wbs>` means "run this whole pipeline" (default `--mode full`). The pipeline's
> internal stages call `/sp:dev-run --mode implement`, `/sp:dev-unit`, `/sp:dev-review`,
> `/sp:dev-verify` — never `/sp:dev-run` in full mode. Calling `/sp:dev-run --mode full` from
> inside the `implement` step would recurse into another full pipeline run. The `implement`
> step is the **implement operation** (dev-operations.md §4); the verify step is
> `sp:code-verification`.

## The pipeline's internal stages

Each stage maps to one operation. The pipeline calls the operation; the operation does exactly
one thing and yields, so the **pipeline (not the agent) owns the loop**.

| Stage | Operation | Defined in |
|-------|-----------|------------|
| `implement` | `/sp:dev-run --mode implement <wbs>` — write the code that satisfies the task; author `## Solution`. | [dev-operations.md §4 run](dev-operations.md) |
| `test` | `/sp:dev-unit <target> --auto` — extend/generate tests to the coverage target. | [dev-operations.md §1 unit](dev-operations.md) → [unit-testing.md](unit-testing.md) |
| `review` | `/sp:dev-review <wbs>` — SECU-framework review of the diff. | [dev-operations.md §2 review](dev-operations.md) |
| `verify` | `sp:code-verification` — requirements traceability + verdict. | [dev-operations.md §3 verify](dev-operations.md) |

**Agent override** for any stage: the `--agent <name|auto>` flag (passed through from
the thin wrapper via `$ARGUMENTS`) selects the executing agent. Omitting it keeps the
pipeline default — the spawned `agent.run` step resolves to the configured executor
(`omp`); **"current agent" is not expressible on the pipeline surface** (the FSM runs a
subprocess, and the calling agent cannot block on itself). `auto` resolves the current
runtime to its canonical name before forwarding; `<name>` is an explicit override. See
[cross-cutting.md](cross-cutting.md) for the full two-surface contract.

## Section ownership — `## Solution`

The implement step **owns** `## Solution` (the change-map). After writing code, before
yielding, the implement agent authors the `## Solution` section — a markdown table listing
each changed file with a `file:line` range and a one-line `what/why` summary — and writes it
via `spur task update <wbs> --section Solution --from-file <tmp>`. Write **only when the
section is bare** (absent, empty, or a known pipeline placeholder); never clobber a
hand-authored change-map. The `replaceSection` upsert guarantees missing→add,
present→replace, never duplicate. If the implement agent forgets, the pipeline's `record`
step backfills a minimal change-map from `git diff --name-only` as a safety net.

## Step 1: Task selection

```bash
spur task list --status backlog --json
spur task list --status wip --json
```

Pick a task. Priority order: WIP tasks first (continue in-progress work), then highest-priority
backlog tasks. Use `--json` for machine consumption; sort client-side by priority/created_at.

**Reuse in-context task state.** Once a task's `show`/`check` output is in your context this
session, do not re-fetch it for data you already hold — reference the prior result. Re-fetch only
when the underlying state changed (e.g. you just wrote a section and need the new
`requiredSections`). When you must fetch, ask for the smallest shape (`--json`, one field), not the
full human dump. This keeps the programmatic drive's cache hit rate high; see the dogfood
cache-conservation discipline (`plugins/sp/skills/dogfood-testing/references/monitor-ledger.md`).

## Step 2: Pipeline run

**Launch async and poll the trace.** A pipeline with `agent.run` stages runs for many minutes
(each stage can take the full `stepTimeoutMs`, default 10 min). Synchronous invocation blocks
the caller for the entire duration and risks an orphaned run if the caller is interrupted
(sync-orphan, see task 0127). Always use `--async` + `spur workflow trace` polling:

```bash
# Async launch + trace polling (recommended)
RUN=$(spur workflow run config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"<wbs>"}' --async --json | jq -r '.runId')
spur workflow trace "$RUN" --json   # poll until status is terminal (done/failed)
```

Synchronous invocation (`--json` without `--async`) is acceptable **only** for short pipelines
(< 2 min, e.g. precheck-only or a dry-run). Do not use it for the full task pipeline.

When `--agent <value>` is set (passed through from the thin wrapper), merge it into the vars:
`--vars '{"wbs":"<wbs>","agent":"<value>"}'`. The pipeline YAML already reads `${vars.agent}`
for every `agent.run` step — no YAML changes needed. `--agent auto` resolves the current runtime
to its canonical agent name before merging; omitting the flag forwards nothing, so the spawned
step resolves to the configured default executor (`vars.agent` defaults to `"omp"` in the
pipeline YAML).

**`--next` resolves to the implement step — it is a chain link, not the pipeline driver.** When the
incoming `$ARGUMENTS` carries `--next`, the mode resolves to `implement` even if `--mode full` was
passed (or defaulted). `--next` means "advance the task to its next step, then hand off" — it runs
the single implement step, transitions the task through the FSM (`todo → wip → testing`, guards
honored), and chains to `/sp:dev-verify <wbs> --auto --next`. On a guard failure it stops as
review-pending (leave status, surface the blocking finding, do not advance). The full pipeline
(no `--next`) still runs every stage internally and ends at `done` on its own. See
`plugins/sp/commands/dev-run.md` `--next` for the exact behavior and the review-pending message.

**MANDATORY `--next`-ignored warning (deterministic emission — not optional prose).** When
`$ARGUMENTS` carries BOTH an explicit `--mode full` AND `--next`, the resolved mode is `implement`
(the explicit `--mode full` has no effect). In that one case the operator MUST be warned before
dispatch — emit the literal string defined in `plugins/sp/commands/dev-run.md` → "Mode resolution
(deterministic — run before dispatch)". The plain `--next` case (no explicit `--mode full`) is the
intended chain link and emits no warning. This emission is a required procedure step, not a
"may mention" note — the trigger is mechanical (`$ARGUMENTS` contains both flags).

The pipeline (`kind: state-machine`) runs the work loop:

```
precheck → implement → test → review → approve(HITL) → verify → record → done
```

Each step is an `agent.run` action carrying `sp:dev-*` command inputs. The skill monitors
the run:

- **On HITL pause** (`approve` state): surface the review output to the operator.
  `spur workflow continue <run-id> --yes` to approve, or provide feedback to loop back.
- **On guard failure** (`precheck`): the task's check findings block progress — fix the
  task first.
- **On completion** (`done`): the pipeline's `record` step has already written results into
  the task's `## Testing` and `## Review` sections via `spur task record <wbs>` (verdict →
  matrix-compliant tables; never transitions to `done` — the gate stays in the workflow).

## Step 3: Continue

After a completed task, decide next action:

- **More tasks in the feature?** Pick the next one, run again.
- **Feature complete?** Run `spur feature update <id> verifying` to mark it for
  acceptance verification.
- **All done?** Run `spur task refresh` + `spur feature refresh` to regenerate the kanban
  and index.

## Skipping HITL

Passing `--vars '{"profile":"auto"}'` to `spur workflow run` (a var choice, not a YAML fork) skips
the `approve` HITL gate — use for low-risk, well-understood tasks where operator review adds no value.
(Combine with `wbs` in one object: `--vars '{"wbs":"0042","profile":"auto"}'`.)
