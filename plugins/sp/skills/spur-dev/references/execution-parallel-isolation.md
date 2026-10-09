---
name: execution-parallel-isolation
description: "Parallel batch isolation (task 1128 split): --mode parallel per-task worktrees, the driver loop, rebase + fast-forward-only integration, conflict retention and generated-region deferral. Read it with --mode parallel."
see_also:
  - execution-batch
  - parallel-execution
---

## Parallel isolation (`--mode parallel`)

Under `--mode parallel` (task 0931) every concurrently running task gets its **own create-mode git
worktree** (`sp/run-<wbs>-<short-id>`, cut from the current base-ref tip). Two task pipelines never
share a working tree, and the main tree receives no task writes while the batch runs. The per-task
pipeline (`task-pipeline.yaml`) is unchanged — only where it runs and when dependents may start
differ. The fan-out decision framework (independence, overlap, budget) stays owned by
[sp:parallel-execution](../../parallel-execution/SKILL.md); this section owns the isolation +
integration lifecycle and reuses WT-1…WT-5 by reference — it defines no new worktree mechanics.

### Driver loop

```
WT-1 once on the main tree (dirty → abort)          # one precheck for the whole batch, not per task
ready = topo frontier; running = {}; integrated = set()
while ready or running:
    while |running| < CONCURRENCY and ready has t with deps(t) ⊆ integrated:
        WT-2 create  sp/run-<wbs>-<short-id> (branch sp/run-<wbs>-<short-id>) from BASE_REF tip
        WT-3 marker  {command: dev-runall, selector: <wbs>, batchId: <batchId>}
                     # WT-3 schema fields (path, branch, baseRef, baseSha) + batchId shared by every marker
        RUN[t] = (cd "$WT" && spur workflow run task-pipeline.yaml \
                  --vars '{"wbs":"<wbs>","deferFeatureSync":"true"[,"deferQualityGate":"true"],...}' --async --json)
                     # deferQualityGate is added ONLY under the opt-in --defer-gate flag (1111 R3):
                     # the task's `test` hop then runs the light tier and writes DEFERRED.
    wait for any RUN terminal        # trace poll --follow --timeout 600000; stale-evidence rule applies
    on done:    WT-3b commit on $BRANCH → integrate(t)
    on failed:  WT-5 retain (marker retained); failure policy — stop-the-batch default / --keep-going subtree skip
    on timeout/paused:  WT-5 retain; run is non-terminal (HITL approve pause or poll bound) — stop-the-batch
                        default / --keep-going subtree skip; the report marks the task `non-terminal`, never `done`
post: integrated full gate on BASE_REF (only under --defer-gate, 1111 R3) -> feature sync + refresh
      per touched feature, one chore(corpus) commit (generated regions, R5)
emit batch report (per-task outcomes + preflight skips + recovery hints + batch verdict)
```

- **Bound (R2).** `CONCURRENCY` is the [`--concurrency <n>`](flag-glossary.md#flag-concurrency)
  value: default **2**, `n ≥ 1`; at most that many pipelines run at once.
- **Eligibility (R2).** A task becomes eligible only when all of its in-set dependencies are
  **integrated** onto the base ref — pipeline-terminal is not enough, because its branch must
  rebase over theirs. Omitting `--mode` stays sequential; this loop is entered only via
  `--mode parallel` on `/sp:dev-runall`.
- **Workdir.** `spur workflow run` records the launch workdir (0784 R1), so launch with `cwd` = the
  task worktree: resume and `.spur/run/` artifact paths resolve there. Read the verdict from
  `$WT/.spur/run/<wbs>-verdict.json` before integration; WT-4a persists it into the invoking tree.

### Integration — rebase, then fast-forward only (R3)

Pipeline-terminal is not terminal under parallel mode. The orchestrator integrates each succeeded
task from the main tree; integrations are **serialized** (one at a time) in completion order:

```
integrate(t):
  git -C "$WT" rebase "$BASE_REF"                # replay onto the CURRENT base tip (re-read per integration)
  ├─ rebase fails → git -C "$WT" rebase --abort → conflict path (R4) below
  └─ rebase clean → git checkout "$BASE_REF" → zero-commit guard → git merge --ff-only "$BRANCH"
                    → WT-4a verdict persist → WT-4b holders → WT-4c registry
                    → git worktree remove → existence-guarded git branch -D → marker merged
```

The merge is always `--ff-only`: a base that will not fast-forward after a clean rebase is a
conflict (R4). The pipeline never creates a merge commit, and no conflict is ever resolved
automatically. `BASE_REF` is re-read at each integration so a task that finished late rebases over
everything integrated before it.

### Conflict — retain, report, block (R4)

A failed rebase is aborted (`git -C "$WT" rebase --abort`), which leaves the worktree clean on its
original branch tip. The worktree and branch are **retained** (WT-5, marker `retained`) and the
task's outcome is `integration-conflict`. There is no auto-resolution — not for generated paths,
not for anything. The batch report's row names the worktree path, the branch, and the manual
commands:

```
resume:  cd <worktree-path> && git rebase <BASE_REF>   # the operator resolves, never the driver
merge:   git checkout <BASE_REF> && git merge --ff-only <branch>
discard: git worktree remove <worktree-path> && git branch -D <branch> && spur projects remove <worktree-path>
```

The task's dependent subtree is blocked under the normal failure policy (Step 4). Resuming a
retained parallel batch with `--continue` is future work; today a retained task is resumed
per-task with `/sp:dev-run <wbs> --worktree <branch>`.

### Generated regions — defer the sync, regenerate once (R5)

The only per-task writer of feature files is the `record` step's post-record feature sync
(`task-pipeline.yaml`). Parallel launches set
the pipeline var `deferFeatureSync: "true"` (default `"false"`): the record step appends
`feature sync deferred to batch integration` to the task report and skips the sync, so task
branches never touch feature files or `docs/features/INDEX.md`. After the last integration, on the
base ref, the orchestrator runs `spur feature sync <f> --json` (service-level suppression) plus `spur feature refresh --feature <f>`
once per touched feature and commits the result as one `chore(corpus)` commit. Sequential and
inline runs keep the default `"false"` and are unchanged. Any rebase conflict — on a generated
path or any other — is an R4 `integration-conflict`; there is no path-based exception.

**Deferred gate (`--defer-gate`, task 1111 R3/R4).** The opt-in flag adds
`deferQualityGate: "true"` to the same per-task `--vars`, so each task's `test` hop runs the light
tier and writes `DEFERRED` instead of a full-gate `PASS` (see
[flag-glossary](flag-glossary.md#flag-defer-gate)). The orchestrator then runs the project
`qualityGateCmd` **once** on the integrated `BASE_REF` **before** the deferred feature sync:

```
if deferred:
    run ${qualityGateCmd} on BASE_REF            # the ONE full gate for the batch
    PASS -> proceed to feature sync (R5)
    FAIL -> batch verdict FAIL; feature sync SKIPPED; report every affected branch with a
            re-gate command, newest-first (git log order); no automatic bisect, no revert
```

Every report row of a deferred task carries `gate: deferred`, so a reader can never mistake a light
receipt for the batch's full-gate evidence. A task with a red light tier follows its normal bounded
fix lane and never reaches integration.

**Report.** Step 5's per-task outcome vocabulary gains the parallel-only `integration-conflict`;
its row carries `worktree`, `branch`, and the manual commands above. Under parallel mode `done`
means **integrated onto the base ref**, not merely pipeline-terminal.

**`--worktree` is rejected under parallel mode.** `--worktree --mode parallel` fails with
"parallel mode already isolates each task in its own worktree" — reuse mode (`--worktree <name>`)
has no per-task meaning (WT-7). Run parallel batches without `--worktree`, or run them sequentially
with it.

**See also:** `sp:parallel-execution` skill (fan-out decision framework), `sp:super-planner` agent
(parallel mode), `execution-batch.md` § Worktree isolation (WT-1…WT-7 mechanics).
