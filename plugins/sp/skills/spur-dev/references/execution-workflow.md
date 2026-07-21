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
  → spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
  → on HITL pause: surface to operator → spur workflow continue [run-id] [--yes]
```

The execution half runs a single task through the `task-pipeline.yaml` workflow. The
pipeline drives the work; the skill interprets results, surfaces HITL gates, and decides
next steps.

> **Single-task vs batch.** This file covers the **single-task** execution half — one task through
> `task-pipeline.yaml`. For **batch** execution (a set of tasks in dependency-correct order), see
> **[execution-batch.md](execution-batch.md)** — it layers set resolution, topological ordering, a
> failure policy, and a batch report on top of this same verbatim pipeline, driven by the
> `sp:super-coder` orchestrator via `/sp:dev-runall`.

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
| `implement` | `/sp:dev-run --mode implement <wbs>` — write the code that satisfies the task; author `## Solution`. | [dev-operations.md §4 run](dev-operations.md) → `sp:code-implementation` |
| `test` | `/sp:dev-unit <target> --auto` — extend/generate tests to the coverage target. | [dev-operations.md §1 unit](dev-operations.md) → `sp:code-testing` |
| `review` | `/sp:dev-review <wbs>` — SECUA-framework review of the diff. | [dev-operations.md §2 review](dev-operations.md) |
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
RUN=$(spur workflow run .spur/workflows/task-pipeline.yaml \
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
(no `--next`) still runs every stage internally and ends at `done` on its own. The exact chain
behavior and the review-pending message live in § "`--next` chain — advance to the next step"
below.

**MANDATORY `--next`-ignored warning (deterministic emission — not optional prose).** When
`$ARGUMENTS` carries BOTH an explicit `--mode full` AND `--next`, the resolved mode is `implement`
(the explicit `--mode full` has no effect). In that one case the operator MUST be warned before
dispatch — emit the literal string in § "Mode resolution (deterministic — run before dispatch)"
below. The plain `--next` case (no explicit `--mode full`) is the
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

## `--next` chain — advance to the next step

`--next` makes `/sp:dev-run` **one link in the linear execution chain**
(`refine → run → verify → done`), not the whole-pipeline driver. It always operates on the
**implement** step: when `--next` is present, the mode resolves to `implement` even if `--mode full`
was passed (full mode runs every step itself, so there is nothing to *advance to* — but rather than
reject the operator's typed flag, `--next` reinterprets it as "run the implement step, then hand
off"). This makes `/sp:dev-run <wbs> --auto --next` work as the headline chain link.

When `--next` is set and implementation succeeds:

0. **Backlog promotion (chain step 0).** If the task's current status is `backlog`, the chain
   first auto-promotes `backlog → todo` via `spur task update <wbs> todo`. The FSM permits this
   transition unguarded (no section gate), so the promotion is pure ceremony — but the chain
   performs it explicitly rather than surfacing a raw `GuardDeniedError: No transition from
   "backlog" to "wip"`. `--auto --next` already expresses the operator's intent to drive the
   task, so the mechanical two-hop (`backlog → todo → wip`) is correct behavior, not a bypass:
   the lifecycle guard stays authoritative for every subsequent transition. If the promotion
   itself fails, stop as review-pending and include both the FSM error and the concrete remediation
   `spur task update <wbs> todo`; never surface a raw `GuardDeniedError` unaided.
1. **Transition through the FSM (guards honored — no `--no-lifecycle`):**
   - `spur task update <wbs> wip` — the `todo → wip` guard is `always`; passes.
   - `spur task update <wbs> testing` — the `wip → testing` guard runs `spur task check <wbs>`.
2. **Record provenance** — `spur task run-link <wbs> --source next-auto --json`. Writes a
   `kind: pipeline` entry into `task_run_links` so the `testing → done` provenance guard
   (lifecycle-adapter.ts L106-131) accepts the in-session implementation path. Idempotent:
   safe to call even when a pipeline link already exists.
3. **On a clean transition:** invoke `/sp:dev-verify <wbs> --auto --next` (`--auto` propagates
   down the whole chain). The verify step's `--next` transition to `done` now passes the
   provenance guard because step 2 recorded the link.
4. **On a guard failure — stop as review-pending:** leave the task at its current status, surface
   the blocking reason (e.g. a missing `## Solution` section that fails `spur task check`), and do
   NOT invoke dev-verify. The chain halts here for the operator to resolve, exactly like the
   pipeline's precheck/HITL gates.

```
review pending — wip → testing guard failed for <wbs>
  spur task check reported: <blocking finding, e.g. "## Solution section is empty">
  task left at wip. Resolve the finding, then re-run: /sp:dev-run <wbs> --auto --next
```

**Status precondition (R2).** The chain assumes the task is at `todo` or later when step 0 is
absent — i.e. the operator has already moved it off `backlog` via `spur task update <wbs> todo`
during refinement. Step 0's auto-promote covers the case where they did not: a `backlog`-seeded
task with `--next` is promoted mechanically rather than denied (`--auto` only controls objective
confirmations). There is no refusal path for `backlog` when `--next` is present. To retain manual
status control, omit `--next` and promote explicitly with `spur task update <wbs> todo` before a
later chained run.

Honoring the guard is the point: the FSM is what stops a malformed task from sliding into `testing`
and then `done`. Bypassing it with `--no-lifecycle` (as the pipeline does for its own internal
transitions) would defeat the review-pending stop the chain exists to provide.

## Mode resolution (deterministic — run before dispatch)

`--next` always resolves the mode to `implement` (the chain link), regardless of `--mode`. The
mode is decided mechanically from `$ARGUMENTS`, then the dispatch runs. This is a
deterministic resolution, not agent discretion.

| `$ARGUMENTS` carries | Resolved mode | Dispatch |
|---|---|---|
| `--next` (with or without `--mode implement`) | `implement` | `implement $ARGUMENTS` |
| `--next` **and** explicit `--mode full` | `implement` + **MANDATORY warning** (below) | `implement $ARGUMENTS` |
| `--mode full` (no `--next`) | `full` | `run $ARGUMENTS` |
| `--mode implement` (no `--next`) | `implement` | `implement $ARGUMENTS` |
| neither (default) | `full` | `run $ARGUMENTS` |

**MANDATORY warning — emit when `$ARGUMENTS` carries BOTH an explicit `--mode full` AND `--next`.**
This is the only case `--next` is "ignored" (the operator asked for the full pipeline *and* the
advance-chain; `--next` won the resolution, so the explicit `--mode full` has no effect). Emit
this literal string to the operator **before** dispatching — it is a required step, not optional
prose:

```
⚠️  --next is ignored in full mode: --next resolves the mode to `implement` (the chain link),
    so an explicit --mode full has no effect. Running the implement step only. Drop --next to
    run the full pipeline, or drop --mode full to silence this warning.
```

The plain `--next` case (no explicit `--mode full`) emits **no** warning — that is the intended
chain-link behavior, not a silent ignore.

## Infrastructure failure recognition (mandatory)

An `agent.run` step timeout (default 600s) or non-zero exit is an **infrastructure signal**,
not a license to bypass the pipeline. The execution pipeline must not be abandoned because
an executor failed — the executor is swappable via config, the pipeline is not.

**When an `agent.run` step fails (timeout, non-zero exit, empty output):**

1. **Diagnose, don't bypass.** Check `spur agent doctor <executor>` — is the agent
   installed? Is auth present? Then check `.spur/config.yaml` → which executor does the
   phase resolve to? Which model does that executor use? Could that model be out of tokens,
   rate-limited, or deprecated?
2. **Switch executors, don't abandon the pipeline.** Override the agent for the run:
   `spur workflow run ... --vars '{"wbs":"<wbs>","agent":"<alt-executor>"}'` or re-run with
   a different `default-by-phase` mapping. The operator can also update config in-flight.
3. **Surface to the operator.** If you cannot determine the cause, ask. Do NOT silently
   fall back to direct implementation. A pipeline step failure is a recoverable event; a
   bypass is an irrecoverable provenance loss.
4. **Never use direct implementation as a fallback.** The `task-pipeline.yaml` `record → done`
   transition is the only mechanism that produces trustworthy task sections. Manual section
   fills via `spur task update --section` are indistinguishable from pipeline output and
   bypass the provenance contract silently.

**Known diagnostic gap:** `spur agent doctor` checks installation, version, and auth — it
cannot detect token quota exhaustion, model deprecation, or rate limits. An executor
configured with `agent: omp` + `model: <provider/model>` passes doctor if `omp` is
installed, even if the model is unavailable. If an `agent.run` times out with no useful
diagnostic, suspect the model, not the agent binary.


## Checkpoint read on resume

When resuming a paused or interrupted pipeline run (`--continue`), read the latest checkpoint
from `.spur/memory/sessions/` before re-launching:

```bash
ls -t .spur/memory/sessions/*-${wbs}-*.md 2>/dev/null | head -1
```

The checkpoint's YAML frontmatter contains `session_id`, `workflow`, `task_wbs`, `phase`,
`last_gate`, `timestamp`, and `next_action`. Surface `next_action` to the operator so they
know where the run left off and what to do next. Checkpoints are written by the pipeline's
checkpoint actions after every HITL gate decision and every phase transition. See
[cross-cutting.md](cross-cutting.md) § "Session Checkpoint Convention" for the full format.
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
