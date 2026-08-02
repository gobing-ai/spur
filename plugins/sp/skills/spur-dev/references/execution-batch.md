---
name: execution-batch
description: "The batch driver loop — resolve+freeze a task set, topologically order by dependencies, run each task's pipeline in order by default or fan out a proven-independent subset on request, inspect terminal verdicts, decide continue/halt, and emit a structured batch report. Owns R1–R5 for batch execution; per-task execution reuses task-pipeline.yaml verbatim (ADR-022: orchestration is a loop in the skill, not a new FSM)."
see_also:
  - spur-dev
  - execution-workflow
  - dev-operations
---

# Execution Batch

`/sp:dev-runall` runs a **set** of task files through their pipelines in one operation, in
dependency-correct order. This file owns the batch algorithm: selector resolution, set freeze,
topological ordering, the per-task run loop, optional parallel fan-out, the failure policy, and the
report shape.

Single-task execution is documented in **[execution-workflow.md](execution-workflow.md)** — this file
extends that procedure to the batch case. Read that file first for the single-task pipeline contract;
everything here assumes a task runs through `.spur/workflows/task-pipeline.yaml` unchanged.

**Zero engine code, zero schema changes (ADR-022).** The batch is orchestration over existing seams —
the status vocabulary (`packages/domain/src/planning/schema.ts`), the `dependencies[]` frontmatter
field, and the per-task `spur workflow run`. Per ADR-022 ("orchestration is configuration / loops in
the skill"), the batch driver is **a loop driven by `sp:super-planner` reading this reference**, not a
new meta-workflow FSM. HITL surfacing, per-task verdict inspection, and continue/halt decisions need
agent judgment between runs that a flat FSM cannot express.

```
/sp:dev-runall  →  sp:super-planner (BATCH ORCHESTRATOR)  →  spur workflow run task-pipeline.yaml (task N)
                                                                  │
                                                                  └─ agent.run steps spawn vars.agent (omp/…)
                                                                     ◄── NOT super-planner's responsibility
```

`sp:super-planner` owns the spaces **between** task runs: resolve+freeze the set, topo-sort, run each
task's pipeline in order by default, optionally fan out a proven-independent subset, inspect terminal
state, decide continue/halt, and emit the batch report. It does **not** decide how an individual
`agent.run` step (implement/test/review) executes — that stays the pipeline's concern via
`vars.agent` (default `omp`, pinned in `task-pipeline.yaml`).

## Step 1 — Selector resolution (R1)

The batch accepts either `--tasks <value>` or the convenience `--feature <id>`.

**Normalization helper (pseudo-code / comment for implementers):**

```ts
// In command layer or batch resolver (before passing to super-planner)
function normalizeArgs(raw: Args): Args {
  const args = { ...raw };
  if (args.feature && !args.tasks) {
    args.tasks = `feature:${args.feature}`;
    // optional: delete args.feature; or keep for reporting
  }
  if (args.feature && args.tasks) {
    // explicit --tasks wins (per Option A)
    console.warn(`--feature ignored because --tasks was provided`);
  }
  return args;
}
```

**Normalization rules (performed by the command layer before the skill sees $ARGUMENTS, or by the batch resolver):**
- If `--feature FOO` is present and `--tasks` is absent, treat the effective selector as `feature:FOO`.
- If both are present, `--tasks` wins (with a one-line note in the batch report).

`--tasks <value>` (or the effective value after normalization) resolves to a frozen set of task WBS numbers. Resolution happens **once, at
kickoff** — the driver never re-queries `spur task list` to recompute membership mid-batch (R2.1).

| Selector form | Regex / match | Resolution |
|---|---|---|
| Explicit WBS list | `^[0-9, ]+$` | Split on comma; validate each token is a 4-digit WBS; collect the explicit set. (R1.1) |
| `feature:<id>` (via `--tasks` or `--feature <id>`) | literal `feature:` prefix or `--feature` flag | `spur task list --feature <id> --json`; collect `wbs` from each row. The `--feature` flag is sugar that becomes `--tasks feature:<id>` at the command layer. (R1.3) |
| `ready` | literal `ready` | Resolve the union of `spur task list --status todo --json` + `spur task list --status backlog --json`, drop tasks with open children (R1.5, umbrella-parent exclusion below), then keep only tasks whose every `dependencies[]` entry resolves to `status == done` (via `spur task show <dep> --json`). Report each excluded task with its unmet dependency. (R1.4) |
| Status pseudo-list | `todo` \| `backlog` \| `wip` \| `blocked` \| `testing` | `spur task list --status <value> --json`; collect `wbs` from each row. (R1.2) |
| *(else)* | no match | Error: "unknown selector `<value>`" — list the valid forms and halt before running anything. |

**Dedup:** an explicit list with a repeated WBS (`--tasks 0040,0040`) collapses to a single entry;
the frozen set is a set, not a multiset.

**Umbrella-parent exclusion:** a `ready` candidate whose `spur task list` shows at least one child
task (any non-`done`/non-`cancelled` task with `parent_wbs == <wbs>`) is dropped from the `ready`
set. By decomposition contract a parent "implements nothing itself" — running it would
re-implement a task that is the abstraction over its children. `spur task batch-create` now
auto-transitions decomposed parents to `wip` and refreshes their `## Plan` roster (task 0178
F1/F2), so a `todo` umbrella with open children is a near-impossible-by-construction state;
this rule is belt-and-braces for the rare case where the parent is re-opened or a child was
created outside `batch-create`. Each excluded parent is reported in the batch report with
`reason: "umbrella parent — <n> open children (<child-wbs-list>)"`.

**`ready` edge note:** a `ready` candidate whose dependency is **out-of-set** is resolved here by
status lookup (satisfied → included). In-set dependencies (a task in the set depending on another
task in the set) are NOT pre-validated by the `ready` selector — they are handled by the ordering
algorithm in Step 2, which guarantees the dep runs first. The `ready` selector only filters on
**out-of-set / already-done** deps.

## Step 2 — Freeze + dependency ordering (R2)

### 2.1 Freeze (R2.1)

The resolved set is **frozen** into an ordered plan before the first `spur workflow run`. The driver
iterates this frozen plan; it never shrinks or re-queries membership mid-batch. Even if a task
transitions to `wip` or `testing` as it runs, every originally-selected task is still attempted in
plan order.

### 2.2 Build the dependency graph

Build a directed graph over the **frozen set** using each task's `dependencies[]` frontmatter. An
edge `A → B` means "A depends on B" (B must complete before A runs). Only edges whose target is
**in the set** contribute to the topological sort; out-of-set deps are resolved by status lookup
(Step 2.3).

### 2.3 Out-of-set dependency resolution

For each dependency edge to a task **outside** the frozen set, resolve its current status via
`spur task show <dep-wbs> --json`:

- status `done` → edge satisfied, drop it from the graph (R2.5). The dependent is unblocked.
- status ≠ `done` → mark the dependent **blocked**. Transitively mark its in-set descendants blocked
  too (fixpoint propagation: any task depending on a blocked task is itself blocked). Exclude all
  blocked tasks from execution and record the unmet dependency + the blocked subtree for the report
  (R2.4). Independent (non-blocked) tasks in the set still run.

### 2.4 Topological sort

Topological-sort the remaining in-set, non-blocked tasks using Kahn's algorithm:

1. Seed the queue with zero-indegree nodes, **sorted WBS-ascending** (deterministic tie-break).
2. Repeatedly dequeue the lowest-WBS zero-indegree node, emit it, decrement its successors'
   indegree, and enqueue any newly-zero nodes — preserving WBS-ascending order on each enqueue.
3. If Kahn exhausts the queue with nodes still unsorted, a **cycle** exists.

**Cycle handling (R2.3):** a cycle aborts the **entire batch** before any task runs. Reconstruct a
representative cycle path via DFS over the remaining unsorted nodes and report it (e.g.
`0040 → 0042 → 0040`). Do not run any task in a cyclic batch — running a prefix would partially
execute work whose ordering is undefined.

### 2.5 Result

The ordered execution plan: a WBS-ascending-topological list of tasks to run, plus a `blocked` list
(with unmet-dep reasons) and (on cycle) an `aborted` flag with the cycle path.

### 2.6 Preflight — TABLE A STOP rows (task 0279 / next-router consumer)

**Before** each `spur workflow run` for a WBS still on the plan, re-check readiness with the pure
helper (preferred) or `sp:next-router` dry-run:

```bash
bun plugins/sp/scripts/batch-preflight.ts \
  --wbs <wbs> --status <status> \
  --deps <comma-deps> --dep-status <wbs:status,...> --json
```

| Result | Batch action |
|--------|----------------|
| `action: run` | Launch `task-pipeline.yaml` for this WBS (happy path **unchanged**) |
| `action: skip` code **A2** | Do not launch; report `preflight-skip` + unmet deps (mirrors TABLE A2) |
| `action: skip` code **A7** | Do not launch; report blocked (handover is operator-side) |
| `action: skip` code **A8**/**A9** | Do not launch; already done / cancelled |

**Invariants:** Preflight never replaces the pipeline with a loop of `/sp:dev-next`. TABLES A/B/C
remain SSOT in `next-router/references/routing-table.md`. Step 2.3 already pre-blocks many unmet
out-of-set deps; 2.6 is belt-and-braces for status STOP rows and a uniform report shape
(`dev-next:`-style reasons). Parallel mode: preflight each WBS before fan-out.

## Step 3 — The driver loop (R3, R4)

```
plan = resolve(--tasks) → freeze → order(deps)        # may abort (cycle) or pre-block (unmet dep)
report = []
for wbs in plan:                                       # default sequential mode
    if any dependency of wbs failed earlier in THIS batch:
        report += skipped(wbs, reason); continue       # only relevant under --keep-going
    preflight = batch-preflight(wbs)                   # Step 2.6 — TABLE A STOP
    if preflight.action == skip:
        report += preflight-skip(wbs, preflight); continue
    run: spur workflow run .spur/workflows/task-pipeline.yaml \
           --vars '{"wbs":"<wbs>","profile":"<auto|standard>","agent":"<value?>"}' --async --json
    poll spur workflow trace <run-id> --json until terminal (done | failed)
    inspect terminal state + .spur/run/<wbs>-verdict.json
    report += outcome(wbs)
    if terminal == failed OR stuck status:
        recovery = recoveryHint(status, wbs)           # Step 3.3b — at most once
        report += recovery-hint(wbs, recovery)
        # optional: if batch --auto and cardinality==1, dispatch recovery.command once
    if terminal == failed:
        if --keep-going: mark wbs + in-batch dependents as failed/skipped; continue
        else:            HALT; remaining → not-attempted; break    # stop-the-batch default (R3.1)
emit batch report (per-task outcome + preflight skips + recovery hints + batch verdict)
```

Parallel mode keeps the same lifecycle but swaps the inner loop for the independent-task batch
pattern in [sp:parallel-execution](../../parallel-execution/SKILL.md): identify a zero-edge,
non-overlapping subset; **preflight each** selected task; run each ready task's `task-pipeline.yaml`
invocation in its own subagent/worktree-safe context; synthesize outcomes; recovery stays
**sequential** (one WBS). If any decision-framework check fails, serialize and record the reason.

### 3.1 Per-task execution reuses the pipeline verbatim (R4)

Each task runs through the **standard single-task pipeline** — `.spur/workflows/task-pipeline.yaml`
— with no new FSM and no step edits. The batch driver invokes it and inspects the result; it never
reaches into a step.

**Launch async and poll the trace** (per execution-workflow.md §"Step 2"): a pipeline with
`agent.run` stages runs for many minutes. Always use `--async` + `spur workflow trace` polling:

```bash
RUN=$(spur workflow run .spur/workflows/task-pipeline.yaml \
  --vars '{"wbs":"<wbs>","profile":"auto","agent":"claude"}' --async --json | jq -r '.runId')
spur workflow trace "$RUN" --json   # poll until status is terminal (done/failed)
```

### 3.2 Flag → `--vars` passthrough (R4.2, R4.3)

Only two flags cross the orchestrator→pipeline boundary; both are merged into the per-task
`--vars` JSON:

| Flag | Effect on per-task `--vars` |
|---|---|
| `--auto` | sets `"profile":"auto"` (skips the HITL approve gate). Omitting it forwards nothing, so the pipeline uses its default profile (standard — HITL pause surfaces to the operator). (R4.2) |
| `--agent <value>` | sets `"agent":"<value>"` so `agent.run` steps spawn that agent. `--agent auto` resolves the current runtime to its canonical name before merging. Omitting it forwards nothing, so spawned steps resolve to the configured default executor (`omp`). (R4.3) |

`sp:super-planner` remains the batch orchestrator regardless of `--agent` — the flag pins the
per-task step executor, not the orchestrator.

### 3.3 Terminal-state inspection

Each pipeline run ends in one of two terminal states:

- **`done`** → the task's `## Testing` / `## Review` sections were filled by the pipeline's `record`
  step; the verdict artifact at `.spur/run/<wbs>-verdict.json` confirms `verdict == PASS`. Record
  `done` in the report.
- **`failed`** → the pipeline hit a gate failure (precheck, verify verdict ≠ PASS, or an
  `onEnter` exception). Record `failed` with the blocking reason from the trace. This triggers the
  failure policy.

### 3.3b One-shot recovery (task 0279 — next-router consumer)

After a non-PASS terminal state (or when the task status is stuck at `wip`/`testing` without a clean
verdict), consult **one** recovery hop:

```bash
bun plugins/sp/scripts/batch-preflight.ts --wbs <wbs> --status <status> --recovery
# → e.g. /sp:dev-verify 0042 --auto --next
```

| Rule | Detail |
|------|--------|
| Budget | **≤ 1** recovery consult per WBS per batch — never loop until done |
| Default | Print the exact child command in the batch report |
| `--auto` batch | May dispatch the child **once** when cardinality is 1 and the hop is a single lifecycle command |
| Multi-candidate | HITL stop — do not silent-pick (batch `--auto` does not break ties) |
| Forbidden | Replacing the whole batch with repeated `/sp:dev-next` (deep-merge) |

Helper: `recoveryHint(status, wbs)` in `plugins/sp/scripts/batch-preflight.ts`. Tables remain SSOT
in next-router; this only maps status → primary TABLE A hop for recovery.

### 3.3c Bounded feature-sync retry suppression (task 0411)

During a batch, the per-task `record` step and the wrap-up `feature-transition` step each invoke
feature status sync. When a feature is L4-gate-blocked (e.g. not all linked tasks are `done`), the
identical blocked proposal repeats on every call with no intervening input change — in the H9
dogfood, 4 redundant sync calls produced the same blocked result. The orchestration seam fixes
this, not the engine.

Both `task-pipeline.yaml` (`record` step) and `wrapup-pipeline.yaml` (`feature-transition` step)
invoke the bounded wrapper instead of raw `feature sync`:

```bash
bun plugins/sp/scripts/feature-sync-bounded.ts <feature-id> --spur-bin "<spurBin>" --json
```

The wrapper:

1. Reads an input fingerprint (feature file content hash, linked task statuses, verdict artifact
   mtimes) **before** invoking `feature sync`.
2. Classifies the structured result — `gateBlocked` checked first (a partial hop can have
   `applied: true` while still gate-blocked), then `applied`, then `no-op`.
3. On a **blocked** result, persists `.spur/run/feature-sync-blocked-<id>.json` and, on the next
   call with an **identical fingerprint**, suppresses the redundant sync and replays the prior
   blocked result.
4. On **applied** or **no-op** results, passes through unchanged (no suppression).
5. When the fingerprint **changes** (a task completed, a verdict file updated), suppression is
   invalidated and a fresh sync runs.

**Batch driver contract:** the orchestrator does **nothing extra** — the wrapper lives inside the
pipeline's `record` step and the wrap-up's `feature-transition` step. The driver still launches
`task-pipeline.yaml` verbatim (R4.1). Suppression is transparent: the wrapper emits the same
`FeatureSyncResult` JSON shape as `feature sync --json`, so downstream report logic is unchanged.
The only observable difference is fewer redundant `feature sync` invocations and a one-line
`feature-sync-bounded:` annotation on stderr when a duplicate is suppressed.

## Step 4 — Failure policy (R3)

### 4.1 Stop-the-batch (default) (R3.1)

By default, the **first** pipeline failure halts the batch. Remaining tasks in the plan are reported
as `not-attempted`. The report lists succeeded, failed, and not-attempted tasks.

### 4.2 `--keep-going` (R3.2)

With `--keep-going`, a failed task does **not** halt the batch. Instead:

- The failed task's **in-batch dependents** (tasks in the plan that transitively depend on it) are
  marked `skipped` with the failed dependency as the reason — they cannot run because their dep did
  not reach `done`.
- **Independent** tasks (no dependency path to the failed task) still run.

This requires the driver to track, per failed task, which later plan entries depend on it —
derivable from the same dependency graph built in Step 2.

## Step 5 — Batch report (R5.2)

When the batch finishes — clean (all `done`), halted (default failure policy), or aborted (cycle /
unknown selector) — emit a structured report. The report is the orchestrator's sole output; it does
not mutate the corpus (the pipeline's `record` step already wrote per-task results).

```
## Batch Report — <selector>

**Selector:** <value>
**Plan:** <n> tasks (ordered: <wbs-list>) · <m> blocked · <p> not-attempted
**Mode:** stop-the-batch | --keep-going | --auto
**Verdict:** clean | halted | aborted

| WBS | Status | Reason |
|-----|--------|--------|
| 0040 | done | — |
| 0042 | failed | verify verdict PARTIAL (see .spur/run/0042-verdict.json) |
| 0050 | not-attempted | batch halted after 0042 (stop-the-batch) |
| 0051 | skipped | dependency 0040 failed (--keep-going) |
| 0060 | blocked | unmet out-of-set dep: 0099 is wip |

**Next:** <one-line action — pick up halted run / resolve 0099 / all green, feature H1 complete>
```

The per-task outcome vocabulary: `done` | `failed` | `blocked` | `skipped` | `not-attempted`.
The batch verdict: `clean` (all attempted tasks `done`) | `halted` (a failure stopped the batch) |
`aborted` (cycle or selector error before any run).

## Still out of scope

- **Interactive within-step Q&A** — a headless subprocess `agent.run` agent asking the operator a
  real question. This waits for the workspace module + inbox module + `spur agent` team mode.
  `sp:super-planner` surfaces blockers/HITL only at the **batch boundary** (between task runs), not
  from inside a pipeline step.

## AC traceability

| AC | Where satisfied |
|---|---|
| R1.1–R1.4 (selector grammar) | Step 1 — selector resolution table |
| R1.5 (umbrella-parent exclusion) | Step 1 — "Umbrella-parent exclusion" paragraph |
| R2.1 (freeze at kickoff) | Step 2.1 |
| R2.2 (topological order) | Step 2.4 (Kahn, WBS-ascending tie-break) |
| R2.3 (cycle aborts) | Step 2.4 cycle handling |
| R2.4 (unmet out-of-set dep blocks subtree) | Step 2.3 + Step 4.2 |
| R2.5 (satisfied out-of-set dep allowed) | Step 2.3 |
| R3.1 (stop-the-batch default) | Step 4.1 |
| R3.2 (`--keep-going` skips subtree) | Step 4.2 |
| R4.1 (each task reuses the pipeline verbatim) | Step 3.1 |
| R4.2 (`--auto` → profile=auto) | Step 3.2 |
| R4.3 (`--agent` merged into per-task vars) | Step 3.2 |
| R5.1 (orchestrator boundary) | "Zero engine code" preamble + Step 3 |
| R5.2 (structured batch report) | Step 5 |
| 0411 (bounded feature-sync retry suppression) | Step 3.3c — wrapper lives in pipeline `record` + wrap-up `feature-transition`; driver unchanged |

## Parallel Execution

When a batch contains tasks with **zero dependency edges between them** and **no file-overlap conflicts**, the orchestrator can fan them out in parallel instead of running them sequentially. This is an **orchestrator-level optimization** — the per-task pipeline (`task-pipeline.yaml`) is unchanged; only the execution order differs.

**Decision framework:** `sp:parallel-execution` owns the full fan-out decision logic and patterns. Consult its [fan-out-patterns.md](../../parallel-execution/references/fan-out-patterns.md) before parallelizing. The orchestrator's responsibility is:
1. Identify the independent subset from the topo-sorted batch (tasks with no edges to each other).
2. Check for file-overlap conflicts (two tasks touching the same `file:line` range must serialize).
3. Verify token budget supports N-way fan-out.
4. Dispatch via `spur agent run` per task (trigger 4: workspace isolation required for parallel fan-out).
5. Synthesize results per the [result-synthesis contract](../../parallel-execution/references/result-synthesis.md).

**Parallel vs. sequential:** the default is sequential (topo-sort order). Parallel is an opt-in via `--mode parallel` on `sp:super-planner` or `/sp:dev-parallel`. When in doubt, run sequentially — parallel is only beneficial when tasks are provably independent.

**See also:** `sp:parallel-execution` skill, `sp:super-planner` agent (parallel mode), `/sp:dev-parallel` command.


## Subagent execution disciplines

Parallel fan-out and any subagent dispatch obey the four disciplines owned by
[sp:parallel-execution](../../parallel-execution/SKILL.md) (its "Subagent execution disciplines" section is the SSOT):

- **File-handoffs** — pass the artifact as a file path, never bulk context in the dispatch prompt.
- **Durable progress ledger** — per-task status + result location recorded in a file/the batch report so a resumed or compacted run knows what already ran.
- **Per-role model selection** — the cheapest model that fits each role (`--agent` pins the executor; the discipline picks the model per role).
- **Never pre-judge the reviewer** — verify/review subagents receive artifact + contract only; no pre-rated severity, no "do not flag X".

## Checkpoint read on batch resume

When resuming an interrupted batch run, read the latest checkpoint from
`.spur/memory/sessions/` before re-launching:

```bash
ls -t .spur/memory/sessions/*.md 2>/dev/null | head -1
```

The checkpoint's YAML frontmatter contains `session_id`, `workflow`, `task_wbs` or `feature_id`,
`phase`, `last_gate`, `timestamp`, and `next_action`. Surface `next_action` to the operator
before resuming. The batch driver reads the checkpoint to determine which task was last
attempted and whether it reached a terminal state. Checkpoints are working memory — the task
files and the frozen task set are the authoritative state. See
[cross-cutting.md](cross-cutting.md) § "Session Checkpoint Convention" for the full format.
