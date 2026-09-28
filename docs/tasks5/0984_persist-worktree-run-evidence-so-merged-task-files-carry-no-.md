---
schema_version: 1
name: Persist worktree run evidence so merged task files carry no dangling .spur/run anchors
status: done
template: feature-impl
created_at: 2026-09-27T07:12:01.569Z
updated_at: "2026-09-28T03:02:42.104Z"
feature_id: H1

ac_altitude: task-local
priority: P1
estimate_hours: 5
---

## 0984. Persist worktree run evidence so merged task files carry no dangling .spur/run anchors

### Background

Found during the `/sp:dev-run 0967 --auto --next --agent inline --worktree` teardown (WT-4).

**Symptom.** After the create-mode worktree was removed and the branch fast-forwarded, the merged task file `docs/tasks5/0967_…md` cites `.spur/run/0967-check-receipt.json` in its `## Testing` evidence — a path that **does not exist** in the invoking tree. Verified by resolving every `.spur/run/…` reference in that file: `0967-check-receipt.json` → DANGLING (all other references resolve to files that survive). The `## Review` section carries the same class of citation.

**Root cause.** The success path persists provenance with `inline-run-setup.ts --persist-out --from <worktree>` (WT-4a) and then tears the tree down (WT-4b: `git worktree remove`). Per its own contract (`plugins/sp/scripts/inline-run-setup.ts:44-52`) persist-out copies only the worktree's **run rows** (`runs` / `action_runs` / `phase_runs` / `transition_runs` / `workflow_states`) plus the **two-file run records** (`.spur/run/<runId>.md`, `.spur/run/<runId>.state.json`) into the invoking tree. The worktree-local **evidence artifacts** — `<wbs>-verdict.json`, `<wbs>-check-receipt.json`, `<wbs>-test-gate.log`, `<wbs>-verify-answer.txt`, `<wbs>-failure-class.decision`, `<wbs>-triage.decision` — are never in that copy set, so they die with the tree while the corpus that cites them merges.

**Observed.** persist-out reported `{"ok":true,"persisted":1,"skipped":[{"id":"run_…","reason":"external-key-conflict"}]}`; the run row and the two-file records landed in the main tree (`.spur/run/20445c34-…md`, `.state.json` present, `workflow progress <runId>` → `status: completed`), and `.spur/run/0967-*` is empty in the invoking tree.

**Scope.** Every task-pipeline run executed with `--worktree` (the documented isolation path for parallel or risky work) that reaches `record` merges a task file whose evidence anchors point at a destroyed directory. The artifacts themselves are already produced and correctly named; only the copy step is missing them.

Related prior work: 0975 (done) defined persist-out's scope as rows + the two-file run records — the worktree-local evidence set was never in scope. Worktree isolation lifecycle: `plugins/sp/skills/spur-dev/references/execution-batch.md` § Worktree isolation.

**Refine corrections (2026-09-27)**

- The original fixed WBS filename list could miss run-ID artifacts cited by the merged task. The corrected copy set is the cited files in that task, with safe names and a fixed cap.
- Missing record files may be normal only for known lifecycle rows; a missing task-pipeline record still aborts persist-out.

### Requirements

- [x] R1. After successful create-mode worktree teardown, every existing `.spur/run/` file cited by the merged task file resolves in the invoking tree. A citation missing in both trees fails before teardown.
- [x] R2. The worktree driver supplies the merged task file path to persist-out; the app service owns citation selection, copying, safe-path validation and conflict behavior. The plugin script remains a thin delegate.
- [x] R3. Copy only regular files directly under the worktree's `.spur/run/` that this task file cites, with a fixed maximum file count and safe single-component names. No wholesale directory copy or path traversal.
- [x] R4. Existing target evidence is never overwritten on a byte conflict; a conflict on a cited file is reported and blocks teardown. Byte-identical copies remain no-ops.
- [x] R5. A known task-lifecycle or feature-lifecycle row with no two-file run record no longer aborts persistence: source ENOENT is reported as `record-missing:<file>`, its inserted DB row still counts in `persisted`. A missing pipeline run record, unreadable DB, unsafe id, or unwritable target remains fatal.
- [x] R6. Regression coverage exercises cited-artifact survival, missing-artifact refusal, a record-less lifecycle row beside a normal run, and conflict/idempotence reporting.

### Acceptance Criteria

- [x] AC1 — Cited pipeline evidence survives worktree teardown, while missing cited evidence prevents teardown (req: R1, R2, R3)
- [x] AC2 — Copying is WBS-bounded, idempotent, and never overwrites a conflicting target file (req: R3, R4)
- [x] AC3 — A record-less lifecycle row is reported without aborting a normal run's transfer; fatal paths stay fatal (req: R5, R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The worktree driver already knows the task it is integrating; pass its merged task-file path to `--persist-out` and then to `persistWorktreeRuns`. Read that one task file and collect its literal `.spur/run/<filename>` citations. Require a safe single-component filename, regular source file, and a fixed cap (initially 64 distinct cited files). For each citation, compare source and target: copy an absent target, treat identical bytes as an idempotent no-op, and report divergent bytes as a conflict without overwrite or teardown. A cited file absent from both trees, or an unsafe/over-cap citation, fails before teardown. This directly covers WBS artifacts and run-ID artifacts without a growing filename allow-list or copying unrelated files. Keep selection and safe-path rules in the app service; the plugin script only forwards the path.

The same app service transfers all run DB rows. A known task-lifecycle or feature-lifecycle row may have no `<runId>.md` or `<runId>.state.json`; catch source ENOENT for those workflow names only and report `record-missing:<file>`. A missing task-pipeline record remains fatal, preserving the green-run evidence guarantee. Keep the lifecycle row's DB insertion and count it in `persisted`; this skip describes a record file, not a skipped row. Other read/write errors remain fatal. This folds in 0979, which targeted the same persist-out owner.

### Plan

- [x] Identify how the worktree driver resolves the current merged task-file path and forward it to persist-out.
- [x] Copy only safe, capped `.spur/run/` files actually cited by that task; fail before teardown on unresolved citations.
- [x] Tolerate source ENOENT only for known lifecycle rows, not pipeline runs; preserve row counts and fatal error behavior.
- [x] Extend the persist-out tests with WBS and run-ID citations, missing citation, unsafe/over-cap citation, normal and record-less runs, target conflict, and unreadable DB/unsafe run id.
- [x] Update the worktree isolation contract line and run focused tests plus `bun run spur-check`.

### Solution

`persistWorktreeRuns` (`packages/app/src/services/inline-run-setup.ts:249`) accepts `taskFiles`; citations are extracted and validated before any write (citation regex `:204`, literal/safe-name reduction `:215`, cap 64 `:193`, regular-file `lstat` check `:294`), then copied with a write-time re-check (`:368-392`). Lifecycle rows tolerate a missing record (`record-missing:` at `:348`); pipeline records stay fatal. `listRunIdRows` (`packages/domain/src/dao/run-transfer.ts:86`) carries `workflowName`. The plugin script forwards a repeatable `--task-file` (`plugins/sp/scripts/inline-run-setup.ts:581`). The WT-4a recipe resolves `TASK_FILE` (`plugins/sp/skills/spur-dev/references/execution-batch.md:846-856`).

Verify fix pass (2026-09-27): `asLiteralRunFileName` now strips trailing sentence punctuation. Before this, an unquoted prose citation `.spur/run/x.json.` became a phantom `x.json.`, which was fatal and blocked teardown. `.spur/run/x.json,` was dropped as non-literal. Pinned by `packages/app/tests/services/persist-worktree-runs.test.ts:274`. `plugins/sp/lib/inline-run.generated.mjs` was regenerated.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | pre-write validation `packages/app/src/services/inline-run-setup.ts:255`; missing-in-both throws `:288`; tests `packages/app/tests/services/persist-worktree-runs.test.ts:165` / `:202` / `:274` (15 pass fresh) |
| R2 | MET | service owns selection `packages/app/src/services/inline-run-setup.ts:249`; thin delegate `plugins/sp/scripts/inline-run-setup.ts:581`; recipe `plugins/sp/skills/spur-dev/references/execution-batch.md:846-856`; tests `plugins/sp/tests/inline-run-setup.test.ts:699` / `:725`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:183` |
| R3 | MET | direct-child regular files only `packages/app/src/services/inline-run-setup.ts:204` / `:215` / `:294`, cap `:193`; tests `packages/app/tests/services/persist-worktree-runs.test.ts:245` / `:300` / `:320` |
| R4 | MET | never overwrite `packages/app/src/services/inline-run-setup.ts:306` / `:383`; tests `packages/app/tests/services/persist-worktree-runs.test.ts:225` (conflict) / `:165` (idempotent) |
| R5 | MET | ENOENT tolerance for bookkeeping lifecycle only `packages/app/src/services/inline-run-setup.ts:348`; tests `packages/app/tests/services/persist-worktree-runs.test.ts:342` / `:377` |
| R6 | MET | all four regression classes above; `packages/app/tests/services/persist-worktree-runs.test.ts` 15/15, `plugins/sp/tests/inline-run-setup.test.ts` 20/20, contract 25/25 pass fresh |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:165` / `:202`; CLI `plugins/sp/tests/inline-run-setup.test.ts:699` / `:725` |
| AC2 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:225` / `:245` / `:320` |
| AC3 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:342` / `:377` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0984

**Scope:** working-tree diff (10 task files + task doc). Verdict: **PASS** — P2 finding #1 remediated in-commit (see disposition).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Citation validation before any write (inline-run-setup.ts:280-290); missing-in-both throws, zero-write asserted; nested-citation skip class documented under accepted P3 |
| R2 | MET | Script forwards repeatable --task-file, thin delegate (:581-620, .mjs parity); app service owns selection/safe-path/conflict (:255-309); driver-supply half now defined in the WT-4a recipe (execution-batch.md: TASK_FILE resolution + TASK_FILE_ARGS array, contract test pinned at execution-batch-contract.test.ts:184-186) |
| R3 | MET | Safe single-component names (:204-220), cap 64 (:193), lstat regular-file-only (:292); no wholesale copy |
| R4 | MET | Divergent bytes throw in validation (:302-305) and at write time (:373-380); identical = no-op; overwrite asserted absent |
| R5 | MET | ENOENT tolerated only for isBookkeepingWorkflow (:342-347); row still persisted (persisted:2); task-pipeline missing record fatal |
| R6 | MET | 9 app tests + 2 plugin e2e + usage case; 13/0 app, 6/0 persist subset, 25/0 contract suite |

##### Findings & Disposition

| # | P | Finding | Disposition |
|---|---|---------|-------------|
| 1 | P2 | WT-4a recipe used undefined $TASK_FILE — literal drivers failed closed | **Fixed in-commit**: recipe now defines TASK_FILE resolution (`spur task show <wbs> --json \| jq -r .filePath`) + TASK_FILE_ARGS array; contract test updated, 25/0 |
| 2 | P3 | Nested citation (`.spur/run/<dir>/<file>`) captures segment-1 → reported as cited-directory skip, file may stay dangling | Accepted: skip is surfaced in persist-out JSON; R1's guarantee is scoped to literal files directly under .spur/run/ (Design). Follow-up candidate |
| 3 | P4 | Write-time divergence throws after transferRunTables committed (partial state) | Advisory: WT-5 retains tree; re-persist idempotent |
| 4 | P4 | Compare-and-decide duplicated between validation and copy loops | Advisory: fold into code-improvement backlog |
| 5 | P4 | feature-lifecycle record-missing covered transitively only | Advisory: acceptable — isBookkeepingWorkflow membership is the contract |

**Residual risk:** concurrent-session doc edits present in tree but excluded from this task's diff and commit.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T07:12:22.662Z backlog → todo (system)
- 2026-09-28T01:32:20.060Z todo → wip (system)
- 2026-09-28T01:46:37.798Z wip → testing (system)
- 2026-09-28T01:46:38.938Z testing → done (system)

