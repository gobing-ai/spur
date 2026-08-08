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
`vars.agent`, which resolves from `agent.default` in `.spur/config.yaml` unless the caller pins an
executor; the `agent: "omp"` literal in `task-pipeline.yaml` is only the fallback when nothing is
configured.

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

## Worktree isolation (`--worktree`)

When a batch command (`dev-runall`, `dev-refineall`, `dev-verifyall`) is invoked with
[`--worktree`](flag-glossary.md#flag-worktree), the entire driver loop runs inside an isolated git
worktree instead of the operator's working directory. This section owns the worktree lifecycle for
the sequential batch loop. Per-task worktrees and `--mode parallel` isolation stay out of scope
(task 0142 Slice A); `--worktree --mode parallel` is rejected.

The lifecycle wraps Steps 1–5 unchanged: a precheck creates the worktree before selector resolution
runs, the loop executes with the worktree as process cwd, and a terminal action merges or retains
after the batch report is emitted. Steps 1–5 themselves are not modified — only their cwd differs.

**Portability (R10).** Use portable `git worktree` commands only. Do **not** depend on the Claude
Code `EnterWorktree`/`ExitWorktree` tools — the `sp` plugin ships to Codex, Gemini CLI, pi, omp, and
OpenCode. The underlying git mechanics (create / list / remove / prune, sibling-directory naming,
disk-space awareness) are reused from [worktree-patterns.md](../../branch-workflow/references/worktree-patterns.md);
this section does not re-author them.

### WT-1 — Dirty-tree precheck (R3)

`git worktree add` branches from a ref, so uncommitted changes in the main tree do **not** carry
into the worktree — a batch would silently run against different tree state than the operator sees.
Before creating the worktree, check the main tree:

```bash
git status --porcelain
```

- **Clean tree** → proceed to WT-2.
- **Dirty tree** → **abort** before any worktree is created. Name the offending files (from
  `git status --porcelain`) and instruct the operator to commit or stash. No task work has run.
- **`--force`** → proceed past a dirty tree with a divergence warning that names the uncommitted
  files. The worktree is created and the batch proceeds against the committed base ref, not the
  operator's working-directory state.

### WT-2 — Worktree creation (R2)

Create one worktree on a new branch cut from the current HEAD's ref (the **base ref** — often a
`feat/…` branch, not literally `main`). Location follows the sibling-directory convention in
[worktree-patterns.md](../../branch-workflow/references/worktree-patterns.md):

```bash
BASE_REF=$(git rev-parse --abbrev-ref HEAD)
BASE_SHA=$(git rev-parse HEAD)
BRANCH="sp/<command>-<selector-slug>-<short-id>"     # e.g. sp/runall-h1-a3f2
git worktree add "../<repo>-<command>-<selector-slug>-<short-id>" -b "$BRANCH" "$BASE_REF"
```

Branch and directory names are derived (command + selector slug + short id); no operator-supplied
name in this slice (R8.3). After creation, immediately write the state marker (WT-3), then run the
existing batch loop (Steps 1–5) with the worktree as process cwd. `spur workflow run` resolves cwd
from the process (`apps/cli/src/commands/workflow.ts:124`), so no CLI change is needed — `cd` into
the worktree directory before launching the loop.

### WT-3 — Crash-safe state marker (R6)

Worktree identity lives on disk under `.spur/run/`, not only in the orchestrator's memory, so a
session that dies mid-batch is recoverable. Write the marker at creation and update it at the
terminal transition (merged / retained). Schema:

```json
{
  "id": "<marker-id>",
  "path": "../<repo>-<command>-<selector-slug>-<short-id>",
  "branch": "sp/<command>-<selector-slug>-<short-id>",
  "baseRef": "feat/example",
  "baseSha": "<sha-at-creation>",
  "command": "dev-runall",
  "selector": "feature:H1",
  "createdAt": "<iso-8601>",
  "status": "active"
}
```

`status` transitions: `active` → `merged` (WT-4 success) | `retained` (WT-5 failure/halt/non-FF).
The marker file is named `.spur/run/worktree-<marker-id>.json`. It is the authority for WT-5 resume
and for operator recovery after a crash: a killed session leaves the marker at `status: active`,
which the operator reads to find the worktree path, branch, and base ref.

### WT-4 — Success path (R4)

When the batch completes with **no failed task**, fast-forward-merge the worktree branch onto the
base ref, then remove the worktree and delete the branch:

```bash
# Run these from the main tree (not inside the worktree) - you merge the worktree branch
# back onto the base ref there:
git checkout "$BASE_REF"
git merge --ff-only "$BRANCH"          # FF-only: never rebase, merge-commit, or resolve conflicts
# if FF succeeded:
git worktree remove "../<worktree-dir>"
git branch -d "$BRANCH"
# update marker: status = "merged"
```

**Fast-forward only.** If the base ref has moved since the worktree was created and FF is
impossible, do **not** rebase, merge-commit, or resolve conflicts — fall through to the retention
path (WT-5) and report the divergence. The corpus files (`docs/tasks*/`, kanban/index) are
auto-generated and conflict-prone; automated conflict resolution over generated files is exactly the
wrong thing to attempt unattended. FF-only means the merge either is trivially correct or does not
happen.

### WT-5 — Failure path: retain and report (R5)

On any per-task failure, batch halt, HITL pause that ends the run, or non-FF merge from WT-4, the
worktree directory and branch are left **intact**. No destructive automation on this path under any
flag combination (`--auto`, `--force`, `--keep-going` — all leave the worktree in place). Update the
marker: `status = "retained"`. Emit a retention report in the existing halt-report shape:

```
## Worktree retained — <command> <selector>

**Halt cause:** <one-line cause — batch halted at task <wbs> / non-FF base ref / HITL pause>
**Worktree path:** ../<worktree-dir>
**Branch:** sp/<command>-<selector-slug>-<short-id>
**Base ref:** <base-ref> (<base-sha>)

The worktree and its branch are intact. Nothing was merged onto the base ref.
Resume, merge, or discard:

  resume:  cd <worktree-path> && <command> --continue --worktree <selector>
  merge:   git checkout <base-ref> && git merge <branch>     # resolve conflicts manually
  discard: git worktree remove <worktree-path> && git branch -D <branch>
```

The report reuses the [`--next` chain contract](flag-glossary.md#-next-chain-contract) halt-report
shape (halt cause + where + why), not new vocabulary. Retention is the right default: these batches
are long and already resumable via `--continue`; auto-deleting is data loss, auto-merging is a
partial result presented as a whole. The answer to "what happens if it fails" is "nothing happens,
and we tell you where the work is."

### WT-6 — `--continue` re-entry (R7)

A `--continue` resume of a batch started with `--worktree` must re-enter the existing worktree via
its WT-3 marker rather than creating a second one. Marker lookup:

1. Scan `.spur/run/worktree-*.json` for a marker whose `command` + `selector` match the current
   invocation and whose `status` is `active` or `retained`.
2. **Found** → `cd` into the marker's `path`, skip WT-1/WT-2 (no new worktree), and resume the loop
   from the checkpoint (Steps 1–5 with `--continue` semantics).
3. **Not found** → fail loudly: "no resolvable worktree marker for `<command> <selector>` under
   `.spur/run/`; cannot resume a `--worktree` batch without one. Re-run without `--worktree` to
   start a new batch in the main tree, or inspect `.spur/run/` for prior markers." Do **not**
   silently run in the main tree.

### WT-7 — Exclusions (R8)

- **`dev-next`** does not get `--worktree` — it dispatches a single step; per-step isolation is not
  worth the worktree cost.
- **`--mode parallel`** is rejected when combined with `--worktree` — per-task worktrees and
  parallel isolation remain task 0142 Slice A.
- **No** operator-supplied worktree name, no `--worktree-keep` variant, no auto-cleanup of stale
  worktrees from prior runs.

### Corpus visibility note

While the batch runs, corpus writes (`spur task update`, `spur feature update`) land in the
**worktree copy**; the operator's main tree still shows pre-run task statuses. This is expected —
the merge (WT-4) or manual integration (WT-5) propagates the writes back. Worth one line in each
command doc so it does not read as a bug.

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
