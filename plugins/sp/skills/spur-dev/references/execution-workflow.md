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
  → interactive omit/inline: host driver reads task-pipeline.yaml and walks it in-session
  → explicit/headless executor: spur workflow run task-pipeline.yaml
  → on HITL pause: surface to operator → resume the selected driver
```

The execution half runs a single task through the `task-pipeline.yaml` FSM. In an interactive
omit/inline invocation, the skill's host driver interprets that YAML directly. Explicit executors
and headless invocations use the workflow engine. Both surfaces preserve the same actions, guards,
artifacts, HITL gates, and terminal states.

> **Single-task vs batch.** This file covers the **single-task** execution half — one task through
> `task-pipeline.yaml`. For **batch** execution (a set of tasks in dependency-correct order), see
> **[execution-batch.md](execution-batch.md)** — it layers set resolution, topological ordering, a
> failure policy, and a batch report on top of this same verbatim pipeline, driven by the
> `sp:super-planner` orchestrator via `/sp:dev-runall`.

This file owns **how operations sequence** in the pipeline. What each operation *does*
(`implement`, `unit`, `review`, `verify`) is defined once in
[dev-operations.md](dev-operations.md) — this file links to it rather than restating it.

> **`/sp:dev-run` drives the pipeline — it is NEVER a pipeline step.** The command
> `/sp:dev-run <wbs>` means "run this whole pipeline" (default `--mode full`). The pipeline's
> internal stages call `/sp:dev-run --mode implement`, shell quality gate + optional
> `/sp:dev-fixall`, `/sp:dev-review`, `/sp:dev-verify` — never `/sp:dev-run` in full mode.
> Calling `/sp:dev-run --mode full` from inside the `implement` step would recurse into another
> full pipeline run. The `implement` step is the **implement operation** (dev-operations.md §4);
> the verify step is `sp:code-verification`.

## The pipeline's internal stages

Each stage maps to one operation. The pipeline calls the operation; the operation does exactly
one thing and yields, so the **pipeline (not the agent) owns the loop**.

| Stage | Operation | Defined in |
| ------- | ----------- | ------------ |
| `implement` | `/sp:dev-run --mode implement <wbs>` — write the code that satisfies the task; author `## Solution`. | [dev-operations.md §4 run](dev-operations.md) → `sp:code-implementation` |
| `test` → (`test-fix` ↔ `test-recheck`) → `review` \| `failed` | **Project quality gate** (not `/sp:dev-unit`). Soft shell probe of `${vars.qualityGateCmd}` (default `bun run autofix && bun run spur-check`) — green path pays **one** full gate run. On FAIL: bounded `/sp:dev-fixall` loop (`qualityGateMaxFixAttempts`, default 2) with soft recheck; exhausted attempts route to pipeline `failed`. `/sp:dev-unit` remains **coverage gap-fill** (router C3/C5 / standalone). | [dev-operations.md §10 fixall](dev-operations.md); unit op still §1 |
| `review` | `/sp:dev-review <wbs>` — SECUA-framework review of the diff. | [dev-operations.md §2 review](dev-operations.md) |
| `verify` | `sp:code-verification` — requirements traceability + verdict. | [dev-operations.md §3 verify](dev-operations.md) |

Interactive omit/`inline` executes these model stages through the
[inline pipeline driver](inline-pipeline-driver.md) in the host session and records stage/session
provenance. The host is the controller; eligible `agent.run` stages may dispatch once to a native
subagent (task 0508), with host fallback and no post-dispatch replay — see the driver reference.
`--agent <name|auto>`, parallel batches, and headless workflow invocation select
the existing subprocess actions. Direct invocations of the same dev operations remain inline by
default. See the [inline-default execution-surface contract](cross-cutting.md#inline-default-execution-surface).

> **Single-run & parse discipline (suite run cost control).** Run full quality/test suites (`bun run check` / `spur-check`) at most ONCE per task iteration (task 0436 R2). Parse failure details from the single retained command output rather than re-running full suites repeatedly to inspect errors. Re-run targeted/narrow test files (e.g. `bun test <file> --test-name-pattern <pattern>`) while iterating on fixes, and re-run the full suite only when all targeted fixes pass.

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

> **Pre-launch size-gate pre-check (R1 / 0478).** Before launching `spur workflow run task-pipeline.yaml`, probe the task's `## Plan` checklist item count (`spur task show <wbs> --json`). The default cap is 8 items (`maxImplementPlanItems: 8`). If the plan item count exceeds 8:
> - Without `--auto`: warn the operator before calling `spur workflow run` and prompt for confirmation or a plan-item override via `--vars '{"maxImplementPlanItems":"<count>"}'`.
> - With `--auto`: automatically append `"maxImplementPlanItems": "<count>"` to `--vars` and log a single-line notice (e.g. `Notice: task <wbs> has N plan items (>8 default cap); injecting maxImplementPlanItems override`).

**Choose the surface before execution.** In an interactive `/sp:dev-run --mode full` invocation,
omit/`--agent inline` selects the [inline pipeline driver](inline-pipeline-driver.md). Read the YAML
at invocation time, allocate the inline run id/session provenance, record `task run-link`, and walk
its actions/guards in declaration order. Do not call `spur workflow run` on this path. `--agent auto`,
a named executor, an explicit `vars.agent`/`vars.implementAgent`, or a headless caller selects the
workflow subprocess path below. Never fall back silently from inline to `agent.default`.

**Subprocess path: launch async, observe with a single `--follow` call.** A pipeline with `agent.run` stages runs
for many minutes (each stage can take the full `stepTimeoutMs`, default 10 min). Synchronous
invocation blocks the caller for the entire duration and risks an orphaned run if the caller is
interrupted (sync-orphan, see task 0127). Always launch with `--async`, then wait with
`spur workflow trace --follow`:

```bash
# Async launch + single blocking --follow call (recommended).
# Full-mode `--auto` runs set profile=auto in the vars; pass --agent to merge the executor.
VARS=$(jq -nc --arg wbs "$WBS" --arg profile auto '{wbs:$wbs, profile:$profile}')
# optional, when --agent <name|auto> is set:
#   VARS=$(jq -nc --arg wbs "$WBS" --arg profile auto --arg agent "$AGENT" \
#         '{wbs:$wbs, profile:$profile, agent:$agent}')
RUN=$(spur workflow run .spur/workflows/task-pipeline.yaml --vars "$VARS" --async --json | jq -r '.runId')
spur workflow trace "$RUN" --follow --output   # streams the run; --output shows the agent log surface
```

**`--follow` is the default wait mechanism — never a manual sleep-poll loop, never `| tail`.** A
`sleep N && spur workflow trace` loop with escalating sleeps reimplements `--follow` badly, and
`trace --follow | tail` buffers through a pipe and hides the live surface (task 0421's sessions
burned ~110 min in 47 sleeps and 55 trace polls waiting on one run; ADR-047 mandates pipe-free
observation). `--follow` is a blocking human-streaming mode (no `--json`); run it in the session
background and let its exit report the terminal verdict. Use `spur workflow trace "$RUN" --follow
--output` to stream the non-interactive agent output to `.spur/run/<runId>.log` as it lands.

Synchronous invocation (`--json` without `--async`) is acceptable **only** for short pipelines
(< 2 min, e.g. precheck-only or a dry-run). Do not use it for the full task pipeline.

On the subprocess path, when `--agent <value>` is set (passed through from the thin wrapper), merge it into the vars as
**both** `agent` and `implementAgent` (task 0483 R2):
`--vars '{"wbs":"<wbs>","agent":"<value>","implementAgent":"<value>"}'`. The pipeline YAML reads
`${vars.agent}` for review/verify/test-fix and `${vars.implementAgent}` for implement — setting
both keys ensures the pinned executor reaches every hop. The full value-semantics contract (one
rule, value table, objective triggers, and headless `inline`→`agent.default` resolution per ADR-047)
lives in [cross-cutting.md](cross-cutting.md#inline-default-execution-surface) — the SSOT.
This file documents only the **workflow-pipeline mechanics**: how the selector reaches `agent.run`
steps. Precedence chain: `--agent` / explicit `--vars` → `agent.default` → YAML literal (see SSOT
§ "Executor precedence chain").

**Mode is explicit before dispatch.** The full pipeline is selected by default or by `--mode full`;
the implement step is selected only by `--mode implement`. `--next` controls lifecycle chaining and
never changes this choice. In particular, every pipeline implement-stage prompt must contain the
literal `/sp:dev-run <wbs> --mode implement`; omitting the mode would recursively launch the full
pipeline (bug-742).

The pipeline (`kind: state-machine`) runs the work loop:

```
precheck → implement → test [→ test-fix → test-recheck] → review → approve(HITL) → verify → record → done
```

Agentic steps use the pure slash inputs declared by each YAML `agent.run` action (ADR-043). The
workflow engine dispatches them; the interactive driver invokes their backing skills in-session.
The `test` hop is primarily
**deterministic shell** (quality gate); only the optional `test-fix` hop is agentic
(`/sp:dev-fixall`). The skill monitors the run:

- **On HITL pause** (`approve` state): surface the review output to the operator. On the subprocess
  path use `spur workflow continue <run-id> --yes`; on the inline path retain the current state and
  resume the host driver with the operator's answer.
- **On guard failure** (`precheck`): the task's check findings block progress — fix the
  task first.
- **On completion** (`done`): the pipeline's `record` step has already written results into
  the task's `## Testing` and `## Review` sections via `spur task record <wbs>` (verdict →
  matrix-compliant tables; never transitions to `done` — the gate stays in the workflow).

## `--next` chain — advance to the next step

`--next` makes an explicit `/sp:dev-run <wbs> --mode implement` invocation one link in the linear
execution chain (`refine → run → verify → done`), not the whole-pipeline driver. It never selects
the implement step by itself. The headline chain link is therefore
`/sp:dev-run <wbs> --mode implement --auto --next`.

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
  task left at wip. Resolve the finding, then re-run: /sp:dev-run <wbs> --mode implement --auto --next
```

**Status precondition (R2).** The chain assumes the task is at `todo` or later when step 0 is
absent — i.e. the operator has already moved it off `backlog` via `spur task update <wbs> todo`
during refinement. Step 0's auto-promote covers the case where they did not: a `backlog`-seeded
task with `--next` is promoted mechanically rather than denied (`--auto` only controls objective
confirmations). There is no refusal path for `backlog` when `--next` is present. To retain manual
status control, omit `--next` and promote explicitly with `spur task update <wbs> todo` before a
later chained run.

Honoring the guard is the point: the FSM is what stops a malformed task from sliding into `testing`
and then `done`. Keep chain transitions on the plain verb so the *lifecycle run* is recorded as
well — `--no-lifecycle` (which the pipeline uses for its own internal transitions, being a run
already) suppresses that record. Since 2026-08-07 it no longer suppresses the structural gate: the
CLI evaluates `spur task check` inline whenever the FSM guard will not, so the review-pending stop
survives the flag.

## Mode resolution (deterministic — run before dispatch)

Mode is decided mechanically from `$ARGUMENTS`; `--next` is not part of mode resolution.

| `$ARGUMENTS` carries | Resolved mode | Dispatch |
| --- | --- | --- |
| `--mode full` (with or without `--next`) | `full` | `run $ARGUMENTS` |
| `--mode implement` (with or without `--next`) | `implement` | `implement $ARGUMENTS` |
| neither (default) | `full` | `run $ARGUMENTS` |

Pipeline stage **`agent.run` inputs** are pure slash commands (ADR-043) that always carry
`--mode implement` on implement; relying on `--next` to select the step is the recursive-pipeline
defect fixed by bug-742. Anti-recursion prose lives in `/sp:dev-run` + `sp:code-implementation`,
not in YAML `input:` essays.

## Infrastructure failure recognition (mandatory)

On the subprocess path, an `agent.run` step timeout (default 600s) or non-zero exit is an **infrastructure signal**,
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
4. **Never use ad-hoc direct implementation as a fallback.** The authorized interactive host
   driver is not a bypass: it reads the YAML, records provenance, and executes `record → done`.
   Manual section fills outside either driver are indistinguishable from pipeline output and bypass
   the provenance contract silently.

**Known diagnostic gap:** `spur agent doctor` checks installation, version, and auth — it
cannot detect token quota exhaustion, model deprecation, or rate limits. An executor
configured with `agent: omp` + `model: <provider/model>` passes doctor if `omp` is
installed, even if the model is unavailable. If an `agent.run` times out with no useful
diagnostic, suspect the model, not the agent binary.

## Large tasks and timed-out implement resume (task 0424)

Two obligations when driving a task that may not fit one implement pass.

**1. Split oversized tasks before pipeline execution.** A single `implement` `agent.run`
has a bounded budget (`implementTimeoutMs`); a task whose requirements cannot plausibly fit
that pass must be split into multiple tasks before `spur workflow run`, not found out at the
timeout wall. Heuristics: > 10 requirements, a change spanning > 8 files, or a multi-module
frontend/backend surface → decompose. The plan step owns this; if a task is already running
and oversized, stop and split rather than raise the budget (task 0398 R4: "stop and record
rather than raise again without sign-off").

**2. Timed-out implement — resume from the partial tree, don't restart.** A timeout kills the
implement `agent.run` (exit 3), the pipeline routes to `failed`, and the task stays `todo` with
the partial work still in the working tree. The failure output names the partial-work artifact
(`.spur/run/<runId>-implement-partial.md`) and this runbook. Recovery:

1. **Recognise.** `.spur/run/<runId>-implement-partial.md` exists, the run reported `exited
   with code 3`, the task is at `todo`. The artifact's `git diff --stat` section is the partial
   work inventory.
2. **Establish green from the partial files.** `bun run format` then `bun run lint` + `bun
   test` (or the affected packages). Fix mechanical formatting/type fallout first; the partial
   tree is the baseline, not a code review target.
3. **Resume the remaining requirements against that tree.** Re-run the implement step with the
   partial diff as explicit context — hand the continuation agent `git diff` (the partial
   changes) and the remaining requirement list, and tell it to complete, not restart. The
   task's `## Solution` is then backfilled from `git diff --name-only`.
4. **Finish via the normal gate, or force-done.** If the resumed implement completes, run it
   through the pipeline/verify gate normally. If the work is manually completed and the
   pipeline is not worth re-driving, use the force-done recovery in
   [`done-housekeeping.md`](done-housekeeping.md) F6 — it carries the provenance obligations
   (honest `done_reason`, verdict regeneration).

**3. Match the executor to the size (task 0487 R3).** Size and executor capability are one
decision, not two. **≥ 6 requirements or ≥ 9 Plan items → a `reviewer`-role executor (the
`reviewer` row of [`roles.md`](../../../references/roles.md) declares the floor), or split the
task.** A `cheap`/`standard`-tier model handed a task that big does not fail fast: it consumes the
entire `implementTimeoutMs` and exits 3 with a partial tree (run `ca130182` — 7 reqs / 9 plan
items / 12+ files → 30 minutes, 6 of 12 files, no tests, no docs, no `## Solution`).

The precheck size gate enforces this: it resolves `$implementAgent`'s capability tier
(`spur agent doctor <exec> --json` → `capabilityTier`) and writes FAIL for a large task on an
executor below the `reviewer` role's floor, naming the executor and its tier. An unknown or
undeclared tier reads as the `coder` floor, so the block is the default. Clear it deliberately —
`--agent <capable>` / `--vars '{"implementAgent":"<capable>"}'`, or split — never by raising
`maxImplementReqs`: the caps accept a big task, they do not make a flash model able to finish one.

The empty-implement guard (`requireDiff` on the task-pipeline `implement` step, R3) fails the
run fast when an implement exits 0 with zero non-corpus changes — a no-op never drifts into
`test`/`review`. A no-op is an implement-input defect, not a resume case: fix the input and
re-run. The same gate checks diff *scope* (task 0487 R1): changes outside the files and explicit
directory/glob prefixes the task body backticks fail the step by name; new files beside a declared
file are allowed, and a pre-dispatch snapshot prevents pre-existing dirt from being charged to the
implementer. Bypass only with a deliberate
`--vars '{"implementScopeGuard":"off"}'`.

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
