---
name: execution-batch
description: "The batch driver loop — resolve+freeze a task set, topologically order by dependencies, run each task's pipeline in order by default or fan out a proven-independent subset on request, inspect terminal verdicts, decide continue/halt, and emit a structured batch report. Owns R1–R5 for batch execution; per-task execution reuses task-pipeline.yaml verbatim (ADR-022: orchestration is a loop in the skill, not a new FSM)."
see_also:
  - spur-dev
  - execution-workflow
  - dev-operations
---

# Execution Batch

## Driver state checklist (re-read this after a compaction)

- **Run id** — the batch id in `.spur/run/worktree-<marker-id>.json`, or the persisted Step 5 report
  filename; every later artifact is keyed by it.
- **Markers under `.spur/run/`** — `worktree-<marker-id>.json` (identity + status),
  `worktree-<marker-id>-batch-report.md` (frozen plan + outcomes), `<wbs>-verdict.json` (verdict),
  `<wbs>-question.md` (paused on an operator question).
- **Re-read per state** — this file (Steps 1–5, WT-6/WT-7), [execution-batch-report.md](execution-batch-report.md)
  at Step 5, [execution-worktree-setup.md](execution-worktree-setup.md) for a worktree start,
  [execution-worktree-landing.md](execution-worktree-landing.md) at batch end,
  [execution-parallel-isolation.md](execution-parallel-isolation.md) for `--mode parallel`,
  [execution-batch-continuation.md](execution-batch-continuation.md) for `--continue`.
- **Never re-derive the plan** — the frozen plan is the persisted report; a new selector match is
  `not-admitted`, not a plan change.

## What this file owns

`/sp:dev-runall` runs a **set** of task files through their pipelines in one operation, in
dependency-correct order. This file owns the batch algorithm: selector resolution, set freeze,
topological ordering, the per-task run loop, optional parallel fan-out, the failure policy, and the
report shape.

Single-task execution is documented in **[execution-workflow.md](execution-workflow.md)** — this file
extends that procedure to the batch case. Read that file first for the single-task pipeline contract;
everything here assumes a task runs through `task-pipeline.yaml` unchanged.

**Zero engine code, zero schema changes (ADR-022).** The batch is orchestration over existing seams —
the status vocabulary (`packages/domain/src/planning/schema.ts`), the `dependencies[]` frontmatter
field, and the per-task task-pipeline driver. Per ADR-022 ("orchestration is configuration / loops in
the skill"), the batch driver is a loop in the host session for interactive sequential omit/inline,
or in `sp:super-planner` for explicit/parallel subprocess execution — never a new meta-workflow FSM.
HITL surfacing, per-task verdict inspection, and continue/halt decisions need judgment between runs
that a flat FSM cannot express.

```
/sp:dev-runall ─┬─ interactive sequential omit/inline → host batch loop → inline YAML driver (task N)
                └─ explicit/parallel/headless → sp:super-planner → spur workflow run (task N)
                                                                       └─ agent.run spawns vars.agent
```

The active batch orchestrator owns the spaces **between** task runs: resolve+freeze the set,
topo-sort, run each task's pipeline, inspect terminal state, decide continue/halt, and emit the
report. It does not redefine individual steps. Interactive sequential omit/inline delegates each
ready WBS to [inline-pipeline-driver.md](inline-pipeline-driver.md); explicit/parallel/headless paths
delegate to the workflow engine and `vars.agent` resolution.

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
- **Per-command admission filters (I33 1023).** Step 1 is the shared baseline; commands may layer
  stricter grammar on top — e.g. `/sp:dev-review` rejects `ready`/status pseudo-lists and the mixed
  `--tasks` + `--feature` combination (exit 2), and accepts multi-id `--feature <id>,<id>` as
  caller-level sugar expanded by the command layer before the resolver.

**Feature-derived strict preflight (R2, task 0510).** After normalization, if the **effective
selector** is `feature:<id>` (whether via `--tasks feature:<id>` or the `--feature <id>` sugar),
run a source-local strict feature check **once** before any task-list resolution, freeze,
dependency resolution, or worktree task execution:

```bash
# monorepo source; installed projects use their resolved `spur` binary
# 1132 R4 (auto-fix-first): repair before checking — machine repairs land first, the
# strict check then judges the repaired file. `--fix` output is collected as
# `autoRepairs` in the batch report.
bun run apps/cli/src/index.ts feature check <id> --fix --json
bun run apps/cli/src/index.ts feature check <id> --strict --json
```

- **Abort shape.** A non-zero check aborts the batch immediately: verdict `aborted`, zero attempted
  tasks, and the structured feature findings (the `--json` finding list) reported verbatim. This is
  the same abort vocabulary as cycle / unknown selector (Step 4/Step 5). **Expected pre-run
  states are classified in code, not here:** the non-aborting set lives in
  `NON_ABORTING_PREFLIGHT_CODES` (`plugins/sp/scripts/batch-preflight.ts`), consumed through
  `classifyFeaturePreflightFindings`, which splits the finding list into `aborting` and
  `nonAborting` and reports `shouldAbort`. `L4.scenario-unverified` is the expected state of any
  not-yet-run feature (its covering tasks have no PASS verdicts yet) and
  `L4.verifying-incomplete-tasks` is the expected state of a `verifying` feature that gained new
  live tasks (a warning in `FeatureCheckService` until `done`); `--strict` elevates both to error,
  so they are reported verbatim but do **not** abort the batch; every other error finding (L1–L3
  structural, `L4.malformed-verdict-artifact`, `L4.uncovered-feature-scenario`) still aborts. The
  terminal feature-transition gate enforces scenario verification after the batch runs, so pre-run
  unverified scenarios and incomplete tasks are transient, not defects (dogfood 2026-08-11,
  feature I2; 2026-10-08, feature H1). Extend the set by editing that constant, never this prose.
- **Auto-repairs are reported.** Structural repairs applied by `--fix` are listed under
  `autoRepairs` in the batch report, so a green preflight that only passed after a machine repair is
  visible rather than silent. Two producers: the task-level `task check <wbs> --fix` inside the
  task-pipeline precheck guard (its `--json` output is captured at
  `.spur/run/<wbs>-auto-repairs.json`) and the feature-level `feature check <id> --fix` pass above.
- **Exactly once.** The check runs once per batch, before `task list`; it is not re-run per task.
- **Non-feature exclusion.** Explicit WBS lists, status pseudo-lists, and `ready` selectors add no
  feature check — only an effective `feature:<id>` selector is feature-derived. When explicit
  `--tasks` overrides `--feature`, the effective selector is not feature-derived, so no check runs.
- **Why.** `FeatureCheckService` emits `L3.scope-delineation` (Scope lacking an In/Out split) as a
  **warning**; feature-scoped batches never ran a strict check before freezing, so the late feature
  transition became the first blocking check. A selector-local strict preflight catches a known
  strict finding before any task pipeline action without changing corpus-wide severity. A not-yet-run
  feature always fails `L4.scenario-unverified` under `--strict`, so that class (and
  `L4.verifying-incomplete-tasks`) is reported-not-aborting per the Abort shape above — the preflight targets defects, not the
  expected pre-run state.
- **Scope.** This preflight is advisory to severity policy: it does not alter `FeatureCheckService`,
  `L3.scope-delineation` severity, `feature sync`, or batch-create.

**Semantic precheck failure under `--auto` (1132 R5).** Per-task precheck runs
`task check <wbs> --fix` before `--precheck` (the task-pipeline precheck guard), so lossless
format defects are repaired in place and never reach the strict verdict. A finding that survives
`--fix` is semantic, and the two profiles diverge:

- **`--auto`:** the task gets **one** `/sp:dev-refineall --auto` refinement pass (exactly one — never
a loop). If the re-run precheck still fails, the task is marked **skipped** with its findings
recorded in the batch report, and independent tasks keep running. The batch does not abort.
- **without `--auto`:** unchanged halt behavior — the batch stops on the failing task (`--keep-going`
still skips only its in-batch dependents).

`--tasks <value>` (or the effective value after normalization) resolves to a frozen set of task WBS numbers. Resolution happens **once, at
kickoff** — the driver never re-queries `spur task list` to recompute membership mid-batch (R2.1).

| Selector form | Regex / match | Resolution |
| --- | --- | --- |
| Explicit WBS list | `^[0-9, ]+$` | Split on comma; validate each token is a 4-digit WBS; collect the explicit set. (R1.1) |
| `feature:<id>` (via `--tasks` or `--feature <id>`) | literal `feature:` prefix or `--feature` flag | `spur task list --feature <id> --json`; collect `wbs` from each row. The `--feature` flag is sugar that becomes `--tasks feature:<id>` at the command layer. (R1.3) |
| `ready` | literal `ready` | Resolve the union of `spur task list --status todo --json` + `spur task list --status backlog --json`, drop tasks with open children (R1.5, umbrella-parent exclusion below), then keep only tasks whose every `dependencies[]` entry resolves to `status == done` (via `spur task show <dep> --json | jq '{wbs, status, dependencies, feature_id}'` — R5 metadata-only). Report each excluded task with its unmet dependency. (R1.4) |
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
`spur task show <dep-wbs> --json | jq '{wbs, status, dependencies, feature_id}'` (R5 metadata-only):

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
node "$(superskill script path sp batch-preflight.mjs)" \
  --wbs <wbs> --status <status> \
  --deps <comma-deps> --dep-status <wbs:status,...> --json
```

| Result | Batch action |
| -------- | ---------------- |
| `action: run` | Launch `task-pipeline.yaml` for this WBS (happy path **unchanged**) |
| `action: skip` code **A2** | Do not launch; report `preflight-skip` + unmet deps (mirrors TABLE A2) |
| `action: skip` code **A7** | Do not launch; report blocked (handover is operator-side) |
| `action: skip` code **A8**/**A9** | Do not launch; already done / cancelled |

**Invariants:** Preflight never replaces the pipeline with a loop of `/sp:dev-next`. TABLES A/B/C
remain SSOT in `next-router/references/routing-table.md`. Step 2.3 already pre-blocks many unmet
out-of-set deps; 2.6 is belt-and-braces for status STOP rows and a uniform report shape
(`dev-next:`-style reasons). Parallel mode: preflight each WBS before fan-out.

### 2.7 Visible batch plan (1105 R3)

The batch publishes a generated two-layer plan in the host's native todo list — letters first, digits
per task only at task start. Rows come from `batch-plan.mjs` (ADR-130 glue over
`packages/app/src/workflow/plan-projection.ts`), reached like `batch-preflight`:
`node "$(superskill script path sp batch-plan.mjs)"`. The visible plan is a projection of the frozen
plan, never a second plan: labels carry identity, updates happen at the boundaries below only, and no
per-task letter is ever hand-assigned.

1. **Kickoff (before the first task):** publish `A Prepare batch` (A1 Resolve and freeze task set, A2
   Order by dependencies, A3 Prepare Git, A4 Publish plan) and `Z Batch report`. The task set is
   unknown before A1, so task letters do not exist yet.
2. **After freeze and ordering (Step 2 complete):** write the frozen ordered list to a temp file as a
   JSON array of `{wbs, name}` and render the waves:

   ```bash
   node "$(superskill script path sp batch-plan.mjs)" waves --tasks <tasks.json>
   ```

   Publish wave 1's rows — one letter (B…Y) per task with no digit children, then `Z Batch report`;
   a batch past 24 tasks publishes the next wave on rollover (same A/Z bookends).
3. **When a task starts:** mark its letter in_progress and add its phase digits, rendered from a
   `spur workflow show task-pipeline.yaml --no-logo --format todo --json` payload:

   ```bash
   node "$(superskill script path sp batch-plan.mjs)" task-children --letter <task-letter> --plan <plan.json>
   ```

4. **When a task ends:** mark the task's letter (and its published digits) with the task's terminal
   outcome — `done` renders completed; `failed`/`skipped`/`blocked` render pending + ` [<outcome>]`
   per the frozen status mapping in
   [inline-pipeline-driver.md](inline-pipeline-driver.md) § Host todo update styles.

## Step 3 — The driver loop (R3, R4)

```
plan = resolve(--tasks) → freeze → order(deps)        # may abort (cycle) or pre-block (unmet dep)
report = []
publish visible plan §2.7: A/Z rows now; one letter per task after this freeze (batch-plan.mjs waves)
commit-guard start --run "$RUN_ID"                     # 1129 R1: fingerprint before the first task writes; the close-out commit stages through it
for wbs in plan:                                       # default sequential mode
    if any dependency of wbs failed earlier in THIS batch:
        report += skipped(wbs, reason); continue       # only relevant under --keep-going
    task check <wbs> --fix; task check <wbs> --precheck   # 1132 R4/R5 — repair first, then judge
    if precheck fails on semantic findings:
        if --auto: one /sp:dev-refineall --auto pass; still failing → report += skipped(wbs, findings); continue
        else:      HALT (unchanged non-auto behavior)
    preflight = batch-preflight(wbs)                   # Step 2.6 — TABLE A STOP
    if preflight.action == skip:
        report += preflight-skip(wbs, preflight); continue
    visible plan (§2.7): letter in_progress + task-children digits at start; letter ← outcome at end
    run: if interactive sequential omit/inline:
             inline-pipeline-driver(task-pipeline.yaml, wbs)
         else:
             spur workflow run task-pipeline.yaml --vars <vars> --async --json
             follow trace until terminal    # spur workflow trace "$RUN" --follow --timeout 600000
                                            # (timeout → one checkpoint, exit 1; run continues — never cancel/relaunch)
    if run paused (escalate HITL ask (0933) or standard-profile approve):
        surface the paused prompt (escalate: .spur/run/<wbs>-question.md via workflow.hitl.ask)
        operator answers: spur workflow continue --answer-text <answer> "$RUN" (escalate) | continue "$RUN" (approve)
        resume the SAME run (never relaunch); maxEscalations (default 2) bounds the ask loop
    inspect terminal state + .spur/run/<wbs>-verdict.json
                                           # accept only if trace .run.runId == $RUN AND verdict mtime ≥ .run.startedAt
                                           # (else outcome = stale-evidence, non-done; failure policy applies)
    report += outcome(wbs)
    if terminal == failed OR stuck status:
        recovery = recoveryHint(status, wbs)           # Step 3.3b — at most once
        report += recovery-hint(wbs, recovery)
        # optional: if batch --auto and cardinality==1, dispatch recovery.command once
    if terminal == failed:
        if --keep-going: mark wbs + in-batch dependents as failed/skipped; continue
        else:            HALT; remaining → not-attempted; break    # stop-the-batch default (R3.1)
emit batch report (per-task outcome + preflight skips + recovery hints + autoRepairs + batch verdict)
```

Parallel mode keeps the same lifecycle but swaps the inner loop for the per-task-worktree fan-out
specified in [§ Parallel isolation](#parallel-isolation---mode-parallel): identify a zero-edge,
non-overlapping subset; **preflight each** selected task; run each ready task's `task-pipeline.yaml`
invocation in its own create-mode worktree; integrate by rebase + `--ff-only` as tasks finish;
recovery stays **sequential** (one WBS). If any decision-framework check fails, serialize and
record the reason.

### 3.1 Per-task execution reuses the pipeline verbatim (R4)

Each task runs through the **standard single-task pipeline** — `task-pipeline.yaml`
— with no new FSM and no step edits. Interactive sequential omit/inline invokes the host
[inline pipeline driver](inline-pipeline-driver.md), which interprets that file; explicit/parallel
execution invokes the workflow engine. The batch loop inspects the result and never redefines a
step.

**Explicit/parallel path: launch async, then one bounded follow** (per execution-workflow.md §"Step 2"): a pipeline with
`agent.run` stages runs for many minutes. Always use `--async` + `spur workflow trace`. The watch is a
single bounded call — `--timeout 600000` (10 minutes) is the one bound; a hand-rolled poll loop (and the
retired "10 minutes or 20 polls" rule) is not needed:

```bash
RUN=$(spur workflow run task-pipeline.yaml \
  --vars '{"wbs":"<wbs>","profile":"auto","agent":"claude"}' --async --json | jq -r '.runId')
spur workflow trace "$RUN" --follow --timeout 600000   # single bounded watch to terminal; checkpoint + exit 1 on timeout
spur workflow trace "$RUN" --json | jq '.run | {runId, status, startedAt}'   # inspect: identity, status, freshness anchor
```

A timed-out follow prints one checkpoint naming the run id and last status and exits 1; the run itself
continues — never cancel or relaunch it over a watch timeout. Resume the watch with the same command.

### 3.2 Flag → `--vars` passthrough (R4.2, R4.3)

Only two flags cross the orchestrator→pipeline boundary; both are merged into the per-task
`--vars` JSON:

| Flag | Effect on per-task `--vars` |
| --- | --- |
| `--auto` | sets `"profile":"auto"` (skips the HITL approve gate). Omitting it forwards nothing, so the pipeline uses its default profile (standard — HITL pause surfaces to the operator). (R4.2) |
| `--agent <value>` | omit/`inline` in interactive sequential mode selects the host driver and is not forwarded. `auto` or a name sets **both** `"agent":"<value>"` and `"implementAgent":"<value>"` so every workflow `agent.run` step — including implement — spawns that executor. Headless omit/inline falls through the executor precedence chain. To pin ONLY implement, pass `--vars '{"implementAgent":"..."}'` separately; that explicit var selects the subprocess path. (R4.3, tasks 0483/0503) The opt-in `fleet` value instead maps the run to `"executor":"fleet"`: every `agent.run` stage dispatches through the agent fleet control plane (0942/ADR-126) and neither `agent` nor `implementAgent` is pinned. |

The host session remains the orchestrator for interactive sequential omit/inline. `sp:super-planner`
owns explicit-executor and parallel paths; there the flag pins the per-task step executor, not the
orchestrator.

### 3.3 Terminal-state inspection

Each pipeline run ends in one of two terminal states:

- **`done`** → the task's `## Testing` / `## Review` sections were filled by the pipeline's `record`
  step; the verdict artifact at `.spur/run/<wbs>-verdict.json` confirms `verdict == PASS`. Record
  `done` in the report.
- **`failed`** → the pipeline hit a gate failure (precheck, verify verdict ≠ PASS, or an
  `onEnter` exception). Record `failed` with the blocking reason from the trace. This triggers the
  failure policy.

**Verify-answer table contract (0948 R9).** A verify stage's
`.spur/run/<wbs>-verify-answer.txt` AC table is exactly four columns:
`| AC | Status | Evidence Type | Evidence |`. The evidence-type token
(`test`, `command`, `static-ref`, `manual-review`, `llm-judge`, `n/a`, or a `+`
compound) is isolated in cell 3. A token merged into the evidence cell fails the
`spur task verdict` answer lint.

**Driver acceptance (0930 R3).** The trace row and `.spur/run/<wbs>-verdict.json` are accepted as
terminal evidence only if BOTH hold:

1. **Identity** — the accepted run is the dispatched run: the **trace's** `.run.runId` equals
   `$RUN` (compare against `spur workflow trace "$RUN" --json | jq -r '.run.runId'`). The verdict
   artifact itself carries no runId — it is WBS-keyed, so it binds to this run only through the
   trace identity plus the freshness check below.
2. **Freshness** — the verdict file's mtime is at least the trace's `.run.startedAt` (a verdict
   written before this run started is a stale child result, not completion evidence).

Otherwise record outcome **`stale-evidence`** (non-`done`); the failure policy applies. A stale or
mismatched artifact never authorizes cancelling or relaunching the run.

### 3.3b One-shot recovery (task 0279 — next-router consumer)

After a non-PASS terminal state (or when the task status is stuck at `wip`/`testing` without a clean
verdict), consult **one** recovery hop:

```bash
node "$(superskill script path sp batch-preflight.mjs)" --wbs <wbs> --status <status> --recovery
# → e.g. /sp:dev-verify 0042 --auto --next
```

| Rule | Detail |
| ------ | -------- |
| Budget | **≤ 1** recovery consult per WBS per batch — never loop until done |
| Default | Print the exact child command in the batch report |
| `--auto` batch | May dispatch the child **once** when cardinality is 1 and the hop is a single lifecycle command |
| Multi-candidate | HITL stop — do not silent-pick (batch `--auto` does not break ties) |
| Forbidden | Replacing the whole batch with repeated `/sp:dev-next` (deep-merge) |

Helper: `recoveryHint(status, wbs)` in `plugins/sp/scripts/batch-preflight.ts`. Tables remain SSOT
in next-router; this only maps status → primary TABLE A hop for recovery.

### 3.3c Feature-sync retry suppression (task 0411; 1004 R3)

During a batch, the per-task `record` step and the wrap-up `feature-transition` step each invoke
feature status sync. When a feature is L4-gate-blocked (e.g. not all linked tasks are `done`), the
identical blocked proposal repeats on every call with no intervening input change. The service fixes
this, not the engine.

Both `task-pipeline.yaml` (`record` step) and `wrapup-pipeline.yaml` (`feature-transition` step)
invoke `spur feature sync <feature-id> --json` directly — retry suppression lives inside the
`FeatureService.syncFeature` implementation:

1. On a **blocked** result (`gateBlocked` checked first — a partial hop can have `applied: true`
   while still gate-blocked — then an unapplied from≠to deferral), the service persists
   `.spur/run/feature-sync-blocked-<id>.json` keyed by an input fingerprint (feature file content
   hash, linked task statuses, verdict artifact mtimes).
2. On the next call with an **identical fingerprint**, the service suppresses the redundant sync
   and replays the prior blocked result (`suppressed: true`) without re-deriving hops.
3. On **applied** or **no-op** results, the state file is cleared (no suppression).
4. When the fingerprint **changes** (a task completed, a verdict file updated), suppression is
   invalidated and a fresh sync runs.
5. `--force` (and an explicit confirm re-attempt) bypass the replay and re-derive live; dry-run
   never reads or writes the state.

**Batch driver contract:** the orchestrator does **nothing extra** — the suppression lives inside
the pipeline's `record` step and the wrap-up's `feature-transition` step. The driver still
launches `task-pipeline.yaml` verbatim (R4.1). Suppression is transparent: the sync emits the same
`FeatureSyncResult` JSON shape (`suppressed: true` added on replay), so downstream report logic is
unchanged. The only observable difference is fewer redundant `feature sync` derivations.

### 3.4 Metadata-only host controller (R5, task 0510)

The batch **orchestrator** reads status, ordering, and terminal state — never task bodies or trace
output. Task `content`, section bodies (Solution/Testing/Review), and full workflow `output` are
stage/subagent data and must not enter the host context on the green path; the controller that
dispatches native subagents must not defeat that isolation by ingesting the very bodies the
subagents are meant to hold (task 0508's dispatch contract is preserved unchanged).

**Green-path projections — every controller-side read is projected to metadata:**

- `task show --json` reads pipe to `{wbs, status, dependencies, feature_id}` only:

  ```bash
  spur task show <wbs> --json | jq '{wbs, status, dependencies, feature_id}'
  ```

  Use this shape for out-of-set dependency resolution (Step 2.3), the `ready` selector's
  dep-status lookups (Step 1), and any other controller-side `task show`. A status-only lookup may
  narrow further (`| jq '.status'`), but never widen.

- Green-path trace observation projects to `.run | {runId, status, startedAt}` only:

  ```bash
  spur workflow trace "$RUN" --json | jq '.run | {runId, status, startedAt}'
  ```

  The controller decides continue/halt from `.run.status` (ADR-044: judge a run by
  `status === 'done'`, never by string-matching a `finalState` name) plus the accepted verdict
  artifact `.spur/run/<wbs>-verdict.json` under the §3.3 acceptance rule (identity + freshness).
  It never streams or re-reads a full trace merely to summarize status.

**Failure-path reads are bounded.** On a failed/blocked task, request only the terminal error and
the minimal anchor set the batch report needs (e.g. the blocking finding line, the unmet-dep WBS,
the verdict line) — never the entire trace. If a fuller trace is needed for diagnosis, that read
belongs to a subagent or the operator, not to the batch controller's report loop.

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

Read [execution-batch-report.md](execution-batch-report.md) at Step 5 — the structured Batch Report
template, the worktree evidence-persistence rules and Step 6 Batch wrap (`--wrap` / `--next`).

## Worktree isolation (`--worktree [<name>]`)

Read [execution-worktree-setup.md](execution-worktree-setup.md) when `--worktree` is passed at batch
start (the lifecycle, WT-1…WT-3b). Read [execution-worktree-landing.md](execution-worktree-landing.md)
at batch end (WT-4/WT-5, the retained-worktree report and the conflict-merge recipe). WT-6/WT-7 and
the corpus-visibility note stay below.

### WT-6 — `--continue` re-entry (R7)

A `--continue` resume of a batch started with `--worktree` must re-enter the existing worktree via
its WT-3 marker rather than creating a second one. Marker lookup tries two paths in order:

1. **Name-resolution path (when `--worktree <name>` is present)** — run the [§ Name resolution](execution-worktree-setup.md#name-resolution---worktree-name)
   algorithm against `<name>`. The resolved worktree's path identifies the marker file to adopt.
   This path covers the common resume shapes: the operator remembers the name used last time, or
   passes the path (tier-1 match).
2. **Command+selector fallback (bare `--worktree` or absent flag)** — scan
   `.spur/run/worktree-*.json` **in the invoking tree** (where WT-3 wrote the marker —
   task 0701 R2c) for a marker whose `command` + `selector` match the current
   invocation and whose `status` is `active` or `retained`. Create-mode runs that did not name their
   tree resolve here.
3. **Found by either path** → `cd` into the marker's `path`, skip WT-1/WT-2 (no new worktree), and
   resume the loop from the checkpoint (Steps 1–5 with `--continue` semantics).
4. **Not found** → fail loudly: "no resolvable worktree marker for `<command> <selector>` under
   `.spur/run/`; cannot resume a `--worktree` batch without one. Re-run without `--worktree` to
   start a new batch in the main tree, or inspect `.spur/run/` for prior markers." Do **not**
   silently run in the main tree.

Name resolution failing at resume (0 or ≥2 hits) has the same abort semantics as a fresh run: it
names candidates and requires the path form — it does **not** fall through to the command+selector
fallback, because `<name>` was explicit and unambiguous intent.

### WT-7 — Exclusions (R8)

- **`dev-next`** does not get `--worktree` — it dispatches a single step; per-step isolation is not
  worth the worktree cost. `dev-run` is different: it drives a whole task pipeline, so it does get
  the flag.
- **`--mode parallel`** is rejected when combined with `--worktree` — parallel mode already
  isolates each task in its own worktree
  ([§ Parallel isolation](#parallel-isolation---mode-parallel)), and reuse mode
  (`--worktree <name>`) has no per-task meaning.
- **`--mode implement`** is rejected when combined with `--worktree` on `dev-run` — that mode *is*
  the pipeline's implement stage (bug-742) and runs in whatever tree the driver set up; a second
  worktree would split one task's evidence across two trees.
- **`dev-review` without `--triage`** is rejected when combined with `--worktree` — a read-only
  review writes nothing worth isolating; review another worktree by passing a path inside it.
- **No** create-with-name (`--worktree <name>` never creates; an unresolvable name is an error),
  no `--worktree-keep` variant, no auto-cleanup of stale worktrees or markers from prior runs.

### Corpus visibility note

While the batch runs, corpus writes (`spur task update`, `spur feature update`) land in the
**worktree copy**; the operator's main tree still shows pre-run task statuses. This is expected —
the merge (WT-4) or manual integration (WT-5) propagates the writes back. Worth one line in each
command doc so it does not read as a bug.

## Gate preflight

The cheap rule gates fail fast when run first — the full-gate run is dominated by the ~65 s test
suite, so a gate run that dies at `test-post-check` or `corpus-check` wastes most of its wall time.
Before launching a full `spur-check-new`:

1. **Run the two rule gates first** — `bun run test-pre-check` (43 rules: `no-console-output`,
   `no-direct-process-spawn`, `cli-*`, `require-corresponding-test`) and `bun run test-post-check`
   (`every-export-has-tsdoc`, `coverage-gate`). They catch boundary/TSDoc violations in seconds.
2. **Promoted code must satisfy the boundary rules `scripts/` never enforced.** A command module
   moving from `scripts/` into `apps/cli/src` must route output through the `CommandOutput` seam (no
   `console.*`), spawn processes via `NodeProcessExecutor` (no `Bun.spawnSync`), get a
   `runtime-boundaries` fs-io exemption for sync reads (mirrors `task.ts`), and a non-command helper
   must not live in `apps/cli/src/commands/` (the noun scan treats every file there as a noun).
3. **Doc/TSDoc edits shift `file:line` anchors** cited by other tasks — the per-task gate surfaces
   them as `L4.anchor-subject-mismatch` (0775: the corpus sweep retired; run `spur task check <wbs>`
   on touched tasks). Repoint the shifted citations (via `spur task update --section`)

## AC traceability

| AC | Where satisfied |
| --- | --- |
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
| 0510 R2 (feature-derived strict preflight) | Step 1 — "Feature-derived strict preflight (R2, task 0510)" |
| 0510 R5 (metadata-only host controller) | Step 3.4 + projected `task show` / trace snippets in Step 1, 2.3, 3.1 |

## Parallel isolation (`--mode parallel`)

Read [execution-parallel-isolation.md § Parallel isolation](execution-parallel-isolation.md#parallel-isolation---mode-parallel)
with `--mode parallel` — per-task worktrees, the rebase + fast-forward integration, conflict
retention and the generated-region deferral.

## Subagent execution disciplines

Parallel fan-out and any subagent dispatch obey the four disciplines owned by
[sp:parallel-execution](../../parallel-execution/SKILL.md) (its "Subagent execution disciplines" section is the SSOT):

- **File-handoffs** — pass the artifact as a file path, never bulk context in the dispatch prompt.
- **Durable progress ledger** — per-task status + result location recorded in a file/the batch report so a resumed or compacted run knows what already ran.
- **Per-role model selection** — the cheapest model that fits each role (`--agent` pins the executor; the discipline picks the model per role).
- **Never pre-judge the reviewer** — verify/review subagents receive artifact + contract only; no pre-rated severity, no "do not flag X".

## Batch continuation (`--continue`) — identity binding + checkpoint reconciliation (task 0919)

Read [execution-batch-continuation.md](execution-batch-continuation.md) with `--continue` — original
identity re-binding, checkpoints-as-hints reconciliation and the resumed-run terminal rules.
