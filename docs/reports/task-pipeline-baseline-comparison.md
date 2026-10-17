# Task pipeline — rewritten pipeline vs the 32-run baseline (task 1240)

Measurement record for feature D65 P2 exit. Read with
[workflow-execution-foundation](../../docs/design/workflow-execution-foundation.md) §1 (the issue
this measures) and ADR-140 (the rewrite whose benefit is being checked).

- **Status: partial.** The baseline is complete and reproducible. The rewritten pipeline produced
  **one** run that got as far as `review` — implement, two gate visits (FAIL, then PASS after
  remediation) and the review hop are measured; it was still in `remediate` visit 2 at the final
  observation (2026-10-17T22:34:30Z), so it never reached `done`. Runs 2 and 3 were not started; their
  exact commands are in §5.
- **Cutoff:** 2026-10-17T22:34:30Z — the final observation. Stage figures captured earlier (the baseline
  roll-up at 22:08Z, attempt D's parent gate at 22:23Z) are labelled with their own instants in §4.
- **Trees:** `/tmp/d65-measure-a7c2` (attempts A–C) and `/tmp/d65-measure-c3f1` (attempt D), both
  `git clone --local` of the D65 worktree at commit `60faec03e`
  (`refactor(workflow)!: rewrite task-pipeline as seven states without the proof chain (1239)`).
  Nothing in this report was produced inside the D65 worktree's own corpus.

Every figure below names how it was produced. A figure that could not be obtained is `n/a` with the
reason — none are interpolated.

## 1. Method

### 1.1 Baseline (old inline-driven `task-pipeline`)

Source of truth: the close-written run summaries the engine wrote for each historical run,
`/Users/robin/xprojects/spur-new/.spur/run/*-summary.json` (44 files; gitignored, so they live only
in the main checkout). Each file is the `RunSummary` object
([run-summary.ts](../../packages/app/src/workflow/run-summary.ts)) plus `runId`, `startedAt`,
`completedAt`; `rows[]` carry per-stage `workMs`, `total` carries the run total.

Selection and aggregation were done by `/tmp/d65-baseline.ts` (reproduced in §6.1), run as:

```bash
cd /Users/robin/xprojects/spur-new
/Users/robin/.bun/bin/bun /tmp/d65-baseline.ts .spur/run
```

A file was included when it had `startedAt`, `completedAt` and a non-empty `rows[]`, contained an
`implement` row, and was not a wrapup (`doc-sync`/`feature-verify`) shape. 33 files qualified.
Stage names are normalized by dropping the ` (visit N)` suffix, so `test (visit 2)` adds to `test`.
Driver overhead is the summary's own `driver overhead` row
([run-summary.ts:591](../../packages/app/src/workflow/run-summary.ts#L591)), summed across runs that
emitted one.

The batch-level view the baseline document used is the same input set through the CLI roll-up:

```bash
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow summary \
  --rollup .spur/run/<runId>-summary.json …   # one --rollup flag per file
```

That path was not needed for the stage table (the JSON already carries `rows`); it renders only the
per-run totals.

### 1.2 Cross-agent figures

```bash
cd /Users/robin/xprojects/spur-new
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts history analyze \
  --since 2026-10-10 --until 2026-10-18 --out /tmp/d65-analyze.json --json
```

17 s, exit 0. The artifact's `bySource` block is the cross-agent view (§3). `spur history analyze`
has **no stage dimension** — it aggregates imported agent transcripts by source/model/session/tool,
not by pipeline state — so it cannot substitute for the per-stage table. That is a limitation of the
figure, not a missing command (the task's refine note asserted the flags were sufficient; they are
sufficient for cross-agent *aggregates*, not for per-stage attribution).

### 1.3 Rewritten pipeline runs

Scratch clone, real subprocess executor, engine trace as the timing source:

```bash
git clone --local /Users/robin/xprojects/spur-new-runall-d65-73c2 /tmp/d65-measure-a7c2
cd /tmp/d65-measure-a7c2
/Users/robin/.bun/bin/bun install --frozen-lockfile --ignore-scripts   # 2354 packages, 1.4 s (warm cache)
/Users/robin/.bun/bin/bun run bundle:config                            # apps/cli/config, exit 0
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' \
  --async --trace-file --json
```

Per-stage time comes from the engine's own projection, which is the measurement ADR-140 item 1
claims:

```bash
spur workflow progress <runId> --json     # states[].actions[].attempts[].{startedAt,completedAt,durationMs}
```

That is engine-measured action time — no host transcript, no driver bookkeeping. The host-session
`spur workflow summary --progress <file> --markdown` render (which since 1237 also prints gate time)
needs a `spur workflow progress <runId> --json` file as input; for a subprocess-executor run there is
no host transcript whose overhead row could be computed, so the **driver-overhead row is `n/a` by
construction for these runs** and engine action time is the comparable quantity.

Probe task: `1243` — "D65 measurement probe: one-line architecture doc note", created inside the
clone only (`spur task create … --skip-ready`, then Requirements/AC via
`spur task update 1243 --section`, then `spur task update 1243 todo`). Two requirements, one AC, one
file (`docs/03_ARCHITECTURE.md`), chosen so the implement hop is short and the gate is the dominant
cost. It exists only in `/tmp/d65-measure-a7c2/docs/tasks5/1243_*.md`; the D65 corpus is untouched.

## 2. Baseline per-stage totals (33 run summaries)

`bun /tmp/d65-baseline.ts .spur/run` — every number is a sum of `rows[].workMs` from the run
summaries, in minutes (rounded).

| Stage | Sum (min) | Runs with the stage | Mean per run (min) |
| --- | --- | --- | --- |
| implement | 404 | 40 visits over 33 runs | 10.1 |
| test-recheck | 310 | 30 | 10.3 |
| review | 216 | 41 | 5.3 |
| test-fix | 147 | 31 | 4.7 |
| verify | 106 | 33 | 3.2 |
| test | 37 | 40 | 0.9 |
| triage | 16 | 36 | 0.4 |
| precheck | 14 | 32 | 0.4 |
| record | 10 | 29 | 0.3 |
| done | 2 | 29 | 0.1 |
| review-fail-triage | 1 | 8 | 0.1 |
| approve | 1 | 1 | 0.6 |
| test-fail-triage | <1 | 27 | <0.1 |
| failed | <1 | 7 | <0.1 |
| escalate | <1 | 1 | <0.1 |
| **agent stages, summed** | **1264** | | |
| **driver overhead** (its own row) | **692** (27.1 % of total) | runs that emitted one | |
| **run totals** (sum of each `total.workMs`) | **2551** | 33 | 77.3 |
| operator/ask wait (sum of `waitMs`) | 25 | | |
| wall span (sum of `completedAt − startedAt`) | 2616 | 33 | |

Unattributed remainder: `2551 − 1264 − 692 = 595 min`. The summary suppresses the `driver overhead`
row when a run's stage windows overlap (parallel runs — [run-summary.ts:581](../../packages/app/src/workflow/run-summary.ts#L581)),
so that residual sits inside runs that have no overhead row; it is not a gap in the extraction.

### 2.1 Reconciliation with the figures quoted in ADR-140 / task 1240

The recorded baseline is "32 runs, 2550 min, driver overhead 815 min (32 %), remediation ~450 min vs
implement 356 min".

| Figure | Recorded | Reproduced here | Reading |
| --- | --- | --- | --- |
| run count | 32 | 33 files qualify | one extra summary file has been written since the baseline snapshot (`c597173a…-summary.json`, started 2026-10-16T22:58Z); excluding it the totals are 2496 min |
| total work | 2550 min | 2551 min | matches to rounding |
| remediation (test-fix + test-recheck) | ~450 min | 457 min | matches |
| implement | 356 min | 404 min | **48 min higher** |
| driver overhead | 815 min (32 %) | 692 min (27.1 %) | **123 min lower** |

The implement and overhead deltas are **not reconciled**: the baseline record keeps only the
aggregate (ADR-140 Why, design §1) and not the run ids or the per-run rows it was computed from, so
which runs or which definition produced 356 / 815 cannot be re-derived. Both figures are labelled by
their producer here rather than averaged or silently floored. Anyone re-baselining should publish
the qualifying file list.

## 3. Cross-agent figures (`spur history analyze`, window 2026-10-10 → 2026-10-17)

From `/tmp/d65-analyze.json` `bySource`. These are imported-transcript aggregates, not pipeline
stage time.

| Source | Records | Tool calls | Input tokens | Cache read | Cost (USD) | Assistant duration (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| pi | 228639 | 80481 | 11,589,007,844 | 11,407,402,562 | 468.32 | 8,153,381,568 |
| grok | 65310 | 6978 | 168,014,534 | 81,491,072 | 0 | 15,139,095 |
| codex | 30491 | 3803 | 1,087,580,391 | 538,397,312 | 679.54 | 12,508 |
| claude | 28789 | 5370 | 727,116,168 | 701,520,379 | 54.51 | 18,331,039 |
| agy | 14952 | 7181 | 0 | 0 | 0 | 970,000 |

Totals: 368,181 records, 103,813 tool calls, 1,202.36 USD, `durationUnmeasured` 21,944 rows.
`codex` and `agy` carry `durationMs: 0` with `durationUnmeasured` equal to their tool-call count, so
their wall-time columns are unusable and are not read as evidence of speed.

## 4. Rewritten-pipeline runs

Four launches were made against the same probe task `1243`; three were stopped by the engine's own
guards before producing a usable run, and those failures are findings in their own right (§6). The
fourth produced the implement, gate and review timings in §4.4.

### 4.1 Attempt A — `agent: codex` (discarded, no timing)

Failed in 168 ms, before any agent work:

```
agent.run 'implement' (codex) dispatch failed: agent dispatch blocked by capability attestation
(0706 R5): executor/spec 'codex' cannot satisfy required capabilities — fsWrite: required=available
actual=unknown provenance=unattested; processSpawn: required=available actual=unknown
provenance=unattested.
```

Run `215fb6ec-3508-4bdc-acd0-a410c48235cb`. Only executors whose `executionCapabilities` block is
declared can run `implement`; in the global config those are `pi-k3`, `pi-sol`, `codex-sol`,
`claude`, `agy-opus-5.5`, `agy-sonnet-5.5` — the bare `codex`/`grok` profiles are not attested. The
next launch used `claude`.

### 4.2 Attempt B — `agent: claude` **with `--trace-file`** (measured: failed at `implement`)

```bash
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' --async --trace-file --json
```

Run `cdf9e001-dc66-4e38-b733-dedb3e7de404`, definition v9, digest `sha256:21ccf260…540618`,
executor `claude` — a real subprocess dispatch (`agent=claude command=claude mode=text
model=claude-opus-5 timeoutMs=2700000`), not a stub.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 306 ms window, 53 ms of executed actions | passed |
| implement (visit 1) | **138 530 ms** (22:09:48.830Z → 22:12:07.361Z) of which the `agent.run` hop is 138 530 ms; agent exit code 0 | **failed** |
| escalate / gate / remediate / review / done | `n/a` — never entered | — |
| driver overhead | `n/a` — no host transcript for a subprocess run (§1.3) | — |
| gate time | `n/a` — never reached `gate` | — |
| run wall clock | 139 737 ms | failed |

Failure message (run log, `spur workflow trace`):

```
agent.run 'implement' (claude) changed files outside task 1243's declared surfaces:
.spur/workflow/cdf9e001-dc66-4e38-b733-dedb3e7de404.jsonl. Implement only the target WBS; revert
the out-of-scope changes (or name those paths in the task body). Set the run var
implementScopeGuard: "off" to bypass.
```

The agent itself did its job — `git status` in the clone shows `M docs/03_ARCHITECTURE.md` beside the
new task file — but the engine's **own** `--trace-file` output landed in the work tree during the
implement window and the diff-scope guard charged it to the agent. See finding 5.

### 4.3 Attempt C — `agent: claude`, same clone, no `--trace-file` (measured: failed at `implement`)

Run `fc2df1af-60e7-449a-9abc-6bf07773d79c`.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 302 ms window, 55 ms of executed actions | passed (with the warning "working tree has uncommitted non-corpus changes — commit or stash before starting a new task") |
| implement (visit 1) | **104 144 ms** (22:13:52.376Z → 22:15:36.524Z), agent exit 0 | **failed** |
| later stages | `n/a` — never entered | — |

Run log: `agent.run 'implement' (claude) exited 0 but produced zero non-corpus file changes, and the
verification-only admission failed — \`/Users/robin/.bun/bin/bun /private/tmp/d65-measure-a7c2/apps/cli/src/index.ts
task check 1243\` exit null: (no output)`.

Two causes stack here, and **neither is "`docs/**` is corpus"** — checked against the code:

1. **The change count is hop-scoped, not tree-scoped.** The empty-implement guard diffs against a
   working-tree snapshot taken **at hop entry**
   ([agent-run.ts:1054](../../packages/app/src/workflow/actions/agent-run.ts#L1054)) and compares with
   `gitChangesSinceSnapshot` ([agent-run.ts:1334](../../packages/app/src/workflow/actions/agent-run.ts#L1334)),
   so the `M docs/03_ARCHITECTURE.md` attempt B left behind was invisible to attempt C's hop. The
   corpus exclusion is not the cause: `excludeGlobs` is built from the registered task folders plus the
   features dir only ([workflow-engine-factory.ts:85-89](../../packages/app/src/services/workflow-engine-factory.ts#L85)) —
   `docs/03_ARCHITECTURE.md` is a non-corpus file, which is exactly why attempt B's scope guard approved it
   and why attempt C's precheck warned about it.
2. **The verification-only admission cannot spawn its own check.** It would have let the empty hop
   through (a task whose corpus is already clean may legitimately certify instead of implement), but
   `taskCheckClean` ([agent-run.ts:1909](../../packages/app/src/workflow/actions/agent-run.ts#L1909)) passes
   `vars.spurBin` as a process `command`, and in this project `spurBin` resolves to a two-word command
   (`/Users/robin/.bun/bin/bun <abs path>/apps/cli/src/index.ts`). A `NodeProcessExecutor` spawn of a
   multi-word command string yields `exit null` with no stdout — the recorded detail — so the admission
   read as a failure. The same `task check 1243 --json` run by hand in that clone exits **0** with
   `"pass": true` (two warnings: empty Design, missing feature_id). So the admission's evidence is the
   defect, not the task's state.

Measurement consequences: a re-run needs a clean tree (the fresh clone in §4.4), and the empty-implement
admission is unusable wherever the CLI is invoked as `bun <script>` rather than a linked `spur` binary.

### 4.4 Attempt D — `agent: claude`, fresh clone, clean tree (the comparable run)

A second scratch clone (`/tmp/d65-measure-c3f1`, same commit, same install/bundle sequence, probe task
`1243` recreated) guarantees a clean tree without any reset in the first clone. Run
`492a9ea5-656c-40cd-8a58-68794ee5b97b`.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 311 ms window, 59 ms of executed actions | passed |
| implement (visit 1) | **129 477 ms** (22:17:03.841Z → 22:19:13.319Z) — real `claude` subprocess hop | passed |
| gate (visit 1) | **252 494 ms** (receipt `durationMs`; `gateRuntimeMs` 252 289, `queueWaitMs` 0), completed 22:23:29.389Z | **FAIL** (`.spur/run/<runId>-gate.status` = `FAIL`) |
| remediate (both visits) | **88 015 ms summed over the two visits** by the projection; the per-visit split is not recoverable (§6.10). Visit 1 sat between gate visit 1 (22:23:29Z) and gate visit 2 (PASS at 22:28:46Z) — real `claude` fix hops | passed (both) |
| gate (visit 2) | **226 477 ms** (receipt `durationMs`; `gateRuntimeMs` 208 471, `queueWaitMs` 0), completed 22:28:45.971Z | **PASS** |
| review (visit 1) | **189 603 ms** (22:28:46.242Z → 22:31:55.850Z) — real `claude` review hop | passed, routed back into `remediate` |
| remediate (visit 2) | running at the final observation | — |
| done | `n/a` — not reached | — |
| run wall clock at final observation | 17.6 min, still `running` | — |

The gate failure is **not** the probe's change: the project gate ran 11 510 tests in 231.55 s with
`1 fail` — `(fail) invocation execution context (1215) > the default runner keeps process cwd/env
when the context is omitted` (`.spur/run/1243-test-gate.log:49`). That test is environment-sensitive
(cwd/env of the runner) and this clone runs from `/tmp`; attribution to the clone environment is an
**inference**, not a measurement — the exact reason it fails there is not established here. The gate
time itself is unaffected by that attribution: 252 s for the full project gate on this tree, then 226 s
for the recheck after remediation.

The `failure-class` decision that routed the FAIL into `remediate` recorded `value: "fix"`,
`confidence: 0.02`, `confidenceLevel: "LOW"`, `degraded: true`, `reason: "low-confidence"`,
`source: "default"` (`.spur/run/1243-failure-class.decision`) — i.e. the deterministic classifier
degraded to its default and the pipeline spent a full 88 s fix hop on a test the probe could not have
broken. That is a routing observation, not a timing one.

**Run state at this report's final observation is stated in §4.5; anything not listed there is `n/a`.**

### 4.5 Final observation (2026-10-17T22:34:30Z)

Run `492a9ea5-656c-40cd-8a58-68794ee5b97b` — `running`, current state `remediate` (visit 2).

| Stage | Time |
| --- | --- |
| precheck | 59 ms |
| implement | 129.5 s |
| gate visit 1 (FAIL) | 252.5 s |
| remediate (both visits) | 88.0 s summed |
| gate visit 2 (PASS) | 226.5 s |
| review visit 1 | 189.6 s |

Sum of the completed stages above: 886 s ≈ **14.8 min** of engine/agent work inside a 17.6 min run wall
clock at the cutoff; the difference is the idle gap between gate visit 1's end and the next action
start plus the unstarted visit-2 tail. **The run did not reach `done` inside this session's budget**,
so it is not a completed pipeline run; `spur workflow progress 492a9ea5-656c-40cd-8a58-68794ee5b97b --json`
in `/tmp/d65-measure-c3f1` is the authority if the reader needs the settled numbers.


## 5. Unfinished: runs 2 and 3

Same scratch clone, same method; pick two more tasks from the clone's corpus (the D65 feature's own
`todo` tasks 1241/1242 are available there and are the honest cross-size sample; a synthetic probe
like 1243 is the cheap one):

```bash
cd /tmp/d65-measure-c3f1            # clean clone; see §4.4
S="/Users/robin/.bun/bin/bun run apps/cli/src/index.ts"

$S workflow run config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1241","agent":"claude","profile":"auto"}' --async --json
$S workflow progress <runId2> --json > /tmp/d65-run2-progress.json   # stage table
$S workflow summary --progress /tmp/d65-run2-progress.json --markdown  # host-transcript render; n/a rows for a subprocess run

$S workflow run config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1242","agent":"claude","profile":"auto"}' --async --json
$S workflow progress <runId3> --json > /tmp/d65-run3-progress.json
```

Finish criterion for the task: three completed runs. Feed each run's `workflow progress --json`
through §1.3's per-state summation and add its row to §4's table beside §2's baseline. Keep the
cutoff/`n/a` discipline: a run that has not reached `gate` reports `n/a` for gate time.

## 6. Findings

1. **The baseline's own headline numbers do not reproduce from its inputs.** Total (2551 min) and
   remediation (457 min) match; implement (404 vs 356) and driver overhead (692 vs 815) do not
   (§2.1). Cause: the baseline published aggregates without the qualifying run-id list. Anyone
   quoting "815 min / 32 %" after the rewrite must re-derive it or accept an unreconciled reference.
2. **`spur history analyze` cannot support a per-stage comparison.** It has no stage dimension
   (§1.2). The task's premise that it is sufficient for "cross-agent per-stage figures" is wrong;
   per-stage time comes from run summaries and, for the rewrite, from `workflow progress --json`.
   Cross-agent data is aggregate only (§3).
3. **Driver overhead is structurally unmeasurable for subprocess-executor runs.** It is computed
   from the host transcript ([run-summary.ts:583](../../packages/app/src/workflow/run-summary.ts#L583)).
   A pipeline run driven by `spur workflow run … --agent claude` has no host driver to charge, so a
   like-for-like overhead comparison needs a *host-executor* run (the `host` executor work item plus
   `spur workflow continue`), not a subprocess one. This report's `n/a` is the design working, but
   the task's "driver overhead beside the baseline" column is only obtainable from host runs.
4. **Executor attestation restricts the cross-agent sample** (§4.1): `codex` without an
   `executionCapabilities` block cannot implement. A cross-agent comparison must either attest the
   executor first or restrict itself to the attested set.
5. **`--trace-file` fails the implement hop on its own trace.** The engine's trace file
   (`.spur/workflow/<runId>.jsonl`) is written into the work tree while `implement` runs, and the
   diff-scope guard (`implementScopeGuard`, R1 of task 0487) counts it as an out-of-scope change:
   run `cdf9e001…` died with exit code 0 from the agent and a scope-guard failure from the engine
   (§4.2). Two ways out — drop `--trace-file` (what §4.4 does) or list `.spur/workflow/` in the task
   body — but a measurement run that wants engine traces cannot currently also pass the guard. Any
   future timing exercise that keeps traces must use `implementScopeGuard: "off"` and say so.
6. **A pre-existing non-corpus edit is invisible to the next implement hop, and the run then fails on
   a warning.** The empty-implement guard counts changes *since the hop's own snapshot*
   ([agent-run.ts:1054](../../packages/app/src/workflow/actions/agent-run.ts#L1054), compared at
   [:1334](../../packages/app/src/workflow/actions/agent-run.ts#L1334)), so `M docs/03_ARCHITECTURE.md`
   left by a previous run made attempt C read as "zero non-corpus file changes" although the tree did
   have one (§4.3). `precheck` had warned about exactly that tree ("uncommitted non-corpus changes —
   commit or stash") without blocking. Re-running a task pipeline therefore needs an externally clean
   tree; the engine reports the hazard and proceeds.
   **Not** the cause, and worth stating because it was the plausible hypothesis: `docs/**` is not
   treated as corpus. The exclusion list is every registered task folder plus the features dir
   ([workflow-engine-factory.ts:85-89](../../packages/app/src/services/workflow-engine-factory.ts#L85)),
   so a docs-only task's edit *is* a counted non-corpus change — `docs/03_ARCHITECTURE.md` got attempt
   B past the same guard.
7. **The verification-only admission cannot spawn its own `task check`.** `taskCheckClean`
   ([agent-run.ts:1909](../../packages/app/src/workflow/actions/agent-run.ts#L1909)) calls
   `NodeProcessExecutor.run({ command: spurBin, args: ['task','check',wbs,'--json'] })`, and where
   `vars.spurBin` is a two-word command (`/Users/robin/.bun/bin/bun <abs>/apps/cli/src/index.ts`) the
   spawn produces `exit null` with no stdout — the recorded detail. The same command run by hand in
   that clone exits **0** with `"pass": true`. So an unlinked CLI invocation silently turns a passing
   admission into a rejection, and the rejection text ("produced zero non-corpus file changes") names
   the wrong cause.
8. **No regression can be asserted from stage time yet.** No run reached `done` inside the observation
   window; `implement` alone measured 129.5 s (D) / 138.5 s (B) / 104 s (C) on a one-sentence doc
   probe, against a baseline implement mean of 10.1 min per run that includes multi-file code tasks —
   not comparable, and not compared here. The one comparable quantity is gate time: 252.5 s (FAIL) +
   226.5 s (PASS after remediation) on this tree, from the check receipts.
9. **The rewrite's structural claim is visible, its time claim is not.** The definition is v9 with 8
   states (`config/workflows/task-pipeline.yaml:25-33`); no `test`/`test-recheck`/`triage`/
   `verify`/`record` rows exist to charge. Whether that converts into less wall time needs completed
   runs (§5) — and the one run observed here spent ~7 min in `gate` (two visits) against 3.2 min in
   `review` and 2.2 min in `implement`, so the gate, not the agent hops, dominated this probe.
10. **`workflow progress` per-visit windows are not per-visit.** For a revisited state the projection
    reports one window keyed by the *first* visit's start: `remediate` visit 1 and visit 2 print the
    same `22:23:30.019Z → 22:31:56.168Z` window, and `gate` visit 1/2 both print the visit-1 start with
    the summed action ms of both visits (479 480 ms = 252 768 + 226 712). Per-state summed action ms
    and the check receipts are reliable; the window columns are not, so any stage table built from
    them will mis-split a revisited stage. An observability defect in the measurement surface the
    rewrite is supposed to provide.
11. **The run needed a second remediation hop after a passed review.** `review` → `remediate` is a
    legitimate route, but on a one-sentence docs task it means the certify-then-fix loop the baseline
    charged as `test-fix`/`test-recheck` (457 min) still exists: it has moved into
    `gate`/`remediate`, and each hop carries a full gate re-run (226 s). Not proof of a regression in
    total work, and not claimed as one — but the rewrite renames the loop rather than removing it.

## 7. Evidence gaps (named, not scored)

- Rewritten-pipeline runs completed: **0**. Attempt A died on executor attestation (168 ms), B on the
  diff-scope guard after a real 138.5 s implement, C on the empty-implement admission after 104 s, D
  completed `precheck` + `implement` + two gates + `review` and was inside `remediate` visit 2 at the
  final observation. The required three completed runs are **not** delivered.
- Gate time: **measured** for attempt D only (252.5 s FAIL, 226.5 s PASS, from the check receipts) —
  the one baseline-comparable figure this session produced; `n/a` for every other attempt.
- Review time: **measured once** (189.6 s, attempt D).
- Driver overhead: **n/a** for every run — a subprocess-executor run has no host transcript (§6.3).
- Baseline reconciliation for implement/driver overhead: **unobtainable** — the baseline's run list
  was not published (§2.1).
- Per-stage cross-agent attribution: **unobtainable from `spur history`** — no stage dimension (§3).
- Runs 2 and 3, and thus any per-stage mean for the rewrite: **not started** (§5).

## 7.1 Timeline of what this session actually did

| Instant (UTC) | Event |
| --- | --- |
| 22:08:2x | scratch clone + `bun install` (1.4 s) + `bundle:config` |
| 22:08:46 | probe task 1243 created in the clone |
| 22:09:01 | attempt A (`codex`) — failed in 168 ms |
| 22:09:47 | attempt B (`claude`, `--trace-file`) started |
| 22:12:07 | attempt B failed at `implement` (diff-scope guard) |
| 22:13:5x | attempt C (`claude`, no trace file, dirty tree) started |
| 22:15:36 | attempt C failed: zero non-corpus changes (attempt B's edit was still in the tree) |
| 22:16:5x | second clone `/tmp/d65-measure-c3f1`, install + bundle + probe task |
| 22:17:02 | attempt D started on a clean tree |
| 22:19:13 | attempt D `implement` passed (129.5 s) |
| 22:19:16 | attempt D `gate` entered |

## 8. Reproduce

### 8.1 `/tmp/d65-baseline.ts`

```ts
// Roll up .spur/run/*-summary.json into per-stage baseline figures.
import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2] ?? '.spur/run';
const norm = (s: string) => s.replace(/ \(visit \d+\)$/, '');
const runs: { j: any; wallMs: number }[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('-summary.json'))) {
    let j: any;
    try { j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    if (!j.startedAt || !j.completedAt || !j.rows?.length) continue;
    const stages = new Set<string>(j.rows.map((r: any) => norm(r.stage)));
    if (!stages.has('implement') || stages.has('feature-verify') || stages.has('doc-sync')) continue;
    runs.push({ j, wallMs: Date.parse(j.completedAt) - Date.parse(j.startedAt) });
}
const stageMs = new Map<string, number>(), stageCount = new Map<string, number>();
let overheadMs = 0, totalMs = 0, wallMs = 0, waits = 0;
for (const { j, wallMs: w } of runs) {
    wallMs += w; totalMs += j.total?.workMs ?? 0;
    for (const r of j.rows) {
        const s = norm(r.stage);
        if (s === 'driver overhead') { overheadMs += r.workMs ?? 0; continue; }
        stageMs.set(s, (stageMs.get(s) ?? 0) + (r.workMs ?? 0));
        stageCount.set(s, (stageCount.get(s) ?? 0) + 1);
        waits += r.waitMs ?? 0;
    }
}
```

### 8.2 Run-summary and progress inputs

- Baseline summaries: `/Users/robin/xprojects/spur-new/.spur/run/*-summary.json` (44 files, main
  checkout, gitignored — not in this worktree, `.spur/run/` here holds verdicts only).
- Run 1 progress: `/tmp/d65-run1-progress.json` (captured at the §4 cutoff).
- History artifact: `/tmp/d65-analyze.json`.
- Launch output: `/tmp/d65-run1-launch.json`, `/tmp/d65-run2-launch.json`, `/tmp/d65-run4-launch.json`,
  `/tmp/d65-install{2}.log`, `/tmp/d65-bundle{2}.log`.
- Two scratch clones at cutoff: `/tmp/d65-measure-a7c2` (attempts A–C; dirty tree, two failed runs,
  one discarded `codex` run) and `/tmp/d65-measure-c3f1` (attempt D; clean tree, `gate` in flight).
  Both are throwaway, so a later session may reuse or re-clone.
