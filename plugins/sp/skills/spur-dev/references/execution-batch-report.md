---
name: execution-batch-report
description: "Batch end of the driver loop (task 1128 split): the Step 5 structured Batch Report template, the zero-task rule, the worktree evidence-persistence contract, and Step 6 Batch wrap (--wrap/--next) including the guarded close-out commit. Read it when Step 5 runs; the loop itself stays in execution-batch.md."
see_also:
  - execution-batch
  - execution-workflow
---

# Batch report and batch wrap

Read at Step 5 and once at batch end (task 1128 R1).

## Step 5 — Batch report (R5.2)

When the batch finishes — clean (all `done`), halted (default failure policy), parked (`paused`:
one or more tasks sit on an operator question (escalate, 0933) or an approval gate), or aborted
(cycle / unknown selector) — emit a structured report. The report is the orchestrator's sole
output; it does not mutate the corpus (the pipeline's `record` step already wrote per-task
results). A `paused` task is non-terminal — the report marks it `paused` (never `done`) and names
the resume command. Unless `--no-summary`, follow it with the measured
[execution summary](dev-operations.md#execution-summary), one `--progress <wbs>=<file>` per attempted run.

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

**Excluded from wrap** (only under `--wrap`/`--next`, when some batch tasks are not `done`):

```
| WBS | Status | Recovery |
|-----|--------|--------|
| 0042 | failed | C6 recovery: /sp:dev-run 0042 (residual report: .spur/run/0042-residual-report.md) |
| 0050 | not-attempted | /sp:dev-next 0050 |
```

A task with a residual report (failing `residual-sweep` check in its verdict artifact) uses the
C6 recovery line (re-run the pipeline); every other excluded task uses the next-router A-row
command for its status (F96 task 0952 R2).

The per-task outcome vocabulary: `done` | `failed` | `blocked` | `skipped` | `not-attempted`,
plus the resume-only `recheck` (stale/mismatched evidence — pipeline re-run), `not-admitted`
(post-freeze selector match, never executed — task 0919 BC-1/BC-2), and the parallel-only
`integration-conflict` (rebase conflict retained for manual integration — task 0931 R4,
[§ Parallel isolation](#parallel-isolation---mode-parallel)).
The batch verdict: `clean` (all attempted tasks `done`) | `halted` (a failure stopped the batch) |
`aborted` (cycle or selector error before any run).

**Zero-task rule (task 0701 R7b).** A selector that resolves to an **empty set after the status
filter** is an `aborted` verdict (`aborted (empty set after filter)`), matching dev-operations.md
§5a. Under `--worktree`, **WT-2 is skipped entirely**: no worktree is cut and no WT-3 marker is
written for a batch with nothing to run. The early-exit report carries zero per-task rows,
`Steps: 0 derived, 0 executed`, and the `aborted` verdict; no WT-3b commit step and no WT-4/WT-5
terminal action runs. A contract test pins this
(`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`).

**Evidence persistence (worktree batches — task 0720 R3).** Copy-out is mandatory.
A worktree batch's Step 5 report, verdict artifacts, and the batch's own
`.spur/run` records live in the worktree while the batch runs — exactly the tree
create-mode WT-4 deletes. Before any WT-4 removal, persist them into the **invoking** tree, which
survives removal:

- Write the emitted batch report to `.spur/run/worktree-<marker-id>-batch-report.md`.
- Copy each attempted task's `.spur/run/<wbs>-verdict.json` from the worktree to
  `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json`.
- Make the report's per-task verdict references use those persisted invoking-tree paths, not the
  worktree-local paths that removal deletes.

Evidence persistence precedes destructive cleanup: a persistence failure (unreadable verdict file,
disk-full, missing directory) routes to **WT-5** — the worktree and branch are retained so a green
batch can never destroy its own evidence. Reuse mode retains its operator-owned tree but still
persists the Step 5 report under the invoking tree; the reused tree's `.spur/run/` remains the live
copy while that tree lives on. The per-run provenance — the worktree DB's run/action rows and the
`.spur/memory/runs/<runId>.md` + `.state.json` records — is persisted mechanically by WT-4a's
`inline-run-setup.ts --persist-out --from <worktree> [--task-file <merged-task>]...` call,
not by hand.

**Stage records are worktree-local too (0948 R9, E7 Finding 5; persisted by 0975 R1).** Each task's
own per-stage run record (`.spur/memory/runs/<runId>.md` + `.state.json`) and the worktree DB's run rows are
written inside the worktree and **are removed with it** in create mode — the E7 batch lost exactly
this evidence. Copying them out is no longer a manual audit-time duty: WT-4a (create-mode block
below) runs `inline-run-setup.ts --persist-out --from "$WT_PATH"` **before** WT-4b holder cleanup,
which copies the run/action/phase/transition/workflow-state rows and both record files into the
invoking tree.

**Cited evidence rides the same call (0984 R1/R2).** The driver forwards each merged task file with
repeatable `--task-file <path>` (paths resolved in the invoking tree after the FF merge, e.g.
`spur task show <wbs> --json` → `.filePath`), and persist-out then copies/verifies every literal
`.spur/run/<file>` that file cites — WBS verdicts, check receipts, test-gate logs, run-ID records —
so a merged task file never anchors a path that died with the tree. Abbreviated references
(`fadca099-…`, `run-*-ac87.log`, `{batch-report.md,…}`) are not literal files and carry no
obligation; neither do root-qualified paths (`knowledge-kit/.spur/run/…`, `/abs/.spur/run/…`),
which cite another project's evidence — cite foreign run artifacts that way, never bare. A citation missing in BOTH trees, a divergent cited file (never overwritten — reconcile
by hand), an unreadable task file, or more than 64 distinct cited files fails the pass → WT-5.

**Durable planes ride it too (E71).** Persist-out copies canonical task verdicts, feature run/latest receipts, nested run artifacts and owned sessions before teardown. Artifact and task-run-link rows are exported with run rows, and stored path references are redirected to the invoking tree. Conflicting or unreadable retained evidence refuses teardown.

**Owned evidence rides it too (1012).** With at least one `--task-file`, persist-out also treats as
copy obligations the worktree's `.spur/run/` direct children named `<wbs>-…` (the WBS is each
forwarded task file's leading four digits before `_`) or `<runId>-…` (every run row in the worktree
DB, whichever task it ran) — `<wbs>-verdict.json`, check receipts, route reasons — whether or not
the task file cites them. They join the cited set: same copy / byte-identical no-op /
divergent-refuse handling. The 64-file cap bounds citations alone; owned names are bounded per
owner (each `<wbs>-` / `<runId>-` prefix gets its own 64-file budget, task 1034), so the bound
scales with the batch and one runaway owner refuses by name before any write. `<runId>.md` /
`<runId>.state.json` stay with the record copy (a conflict is reported and the delegate refuses teardown). Files
matching neither a citation nor an ownership prefix are left behind. An absent worktree `.spur/run/`
means nothing is owned; any other listing failure (not a directory, permission denied) fails the
pass before the invoking tree is written → WT-5. Without `--task-file` nothing is enumerated.

The shapes are pinned (task 0975 R1; `record-missing` and citation behavior per 0984): idempotent on re-persist;
success exits 0 printing
`{"ok":true,"persisted":<n>,"skipped":[{"id":<run-id>,"reason":"id-exists"|"external-key-conflict"|"record-conflict:<file>"|"record-missing:<file>"|"cited-directory:<name>"|"cited-symlink:<name>"|"cited-non-file:<name>"}]}`
— an `external-key-conflict` skip leaves the target run unchanged **and fails the pass (1049)**: the delegate exits 1 printing `{"ok":false,"error":…}` naming the skipped source run ids, because that (workflow, external key) identity already belongs to a different receiving run — the batch was not persisted, so reconcile the source worktree by hand (it stays the provenance owner of record) before any teardown: auditable reconciliation names the original archived DB snapshot and the skipped source run identities, verifies the archive by file hash and by merged-commit ancestry of the source branch, and treats any residual deletion as explicit operator-authorized cleanup under the strict canonical evidence rules above. An `id-exists` replay repairs missing owned artifacts and task links without duplicating them. A
`record-conflict:<file>` never overwrites a divergent invoking-tree record and causes the delegate to exit 1, retaining the worktree. A
`record-missing:<file>` skip is a known `task-lifecycle`/`feature-lifecycle` row with no record file
at all (its inserted DB row still counts in `persisted` — 0984 R5). Any failure
exits 1 printing `{"ok":false,"error":<message>}` (a worktree DB run id that is not a single safe
filename component is rejected before any target write). Any persist-out failure
routes to **WT-5** — worktree and branch retained — the same copy-out-first contract as the
verdict persistence above. After a green persist-out, `spur workflow progress --json` in the
invoking tree shows the merged run `done` with its per-action rows.

## Step 6 — Batch wrap (`--wrap` / `--next`) (F96 task 0952 R1)

Run **once for the batch**, after the Step 5 report — never per task (dev-operations.md §runall
agrees; the old "per task" flag-row wording in dev-runall.md was a contradiction, now fixed).

The wrap receives only what it would accept:

1. `vars.tasks` = the JSON-encoded array of batch WBS whose terminal status is `done`. A task that
   is `failed`/`blocked`/`skipped`/`not-attempted`/`recheck`/`not-admitted` is **excluded** —
   `wrapup task-resolve` refuses non-done members (wrapup-steps.ts task-resolve), so the driver
   simply stops handing the wrap tasks it would refuse.
2. `vars.feature` = the batch feature **only when every task in the frozen batch is `done` or
   `cancelled`**. Otherwise omit it and print `feature lifecycle not advanced: <n> task(s)
   unfinished` — advancing a feature while some of its batch tasks are unfinished would overstate
   completion. Learnings/metrics capture still happens for the done subset.
3. When the done subset is **empty**, skip the wrap entirely with the reason (e.g. `batch wrap
   skipped: no done tasks`) instead of invoking wrapup-pipeline on an empty set.

**Repo-wide tripwire (1037).** After the doc-sync exits converge, the pipeline's `doc-tripwire` hop
runs the TRUSTED CONFIG ONLY `docTripwireCmd` over the still-uncommitted wrap diff before
metrics-record. The default probes `package.json` for a `test-repo-wide` script and runs
`bun run test-repo-wide` only when it is declared (a no-op in other projects), so the batch driver
passes no extra vars. Batch callers override it like any wrap var (`docTripwireCmd` in `--vars`);
an empty string disables the check while still recording PASS. A FAIL routes the wrap to `failed`
with already-written learnings/docs preserved — fix the flagged working-diff violation and re-run
the wrap.

Filtering lives here, in the batch driver — no change to wrapup-pipeline.yaml or wrapup-steps.ts;
the wrap's refusal of non-done tasks remains the hard invariant.

**Close-out commit (1129 R2/R5).** In sequential mode the wrap's writes (learnings, metrics,
doc-sync) land in the invoking tree and are committed as ONE close-out commit after the wrap exits.
Stage them through the guard — never a free-form `git add` — so a concurrent writer's file cannot
ride into the close-out commit (incident `36f274590`):

```bash
GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)"
bun "$GUARD" check --run "$RUN_ID"                    # 1129 R3: a non-empty foreign list goes in the batch report
bun "$GUARD" stage --run "$RUN_ID" -- <files the wrap wrote> \
  || { echo "close-out halt: commit-guard refused a path (foreign, unmerged or conflict-marked); nothing committed" >&2; exit 1; }
git commit -m "chore(wrap): <command> <selector> close-out writes"
```

> **Forbidden:** `git add -A` and `git add .` — here as in every driver commit step. In the
> worktree batch the same rule rides in the WT-3b block above.
