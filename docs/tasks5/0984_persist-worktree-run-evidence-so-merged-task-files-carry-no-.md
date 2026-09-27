---
schema_version: 1
name: Persist worktree run evidence so merged task files carry no dangling .spur/run anchors
status: todo
template: feature-impl
created_at: 2026-09-27T07:12:01.569Z
updated_at: "2026-09-27T16:45:15.960Z"
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

- [ ] R1. After successful create-mode worktree teardown, every existing `.spur/run/` file cited by the merged task file resolves in the invoking tree. A citation missing in both trees fails before teardown.
- [ ] R2. The worktree driver supplies the merged task file path to persist-out; the app service owns citation selection, copying, safe-path validation and conflict behavior. The plugin script remains a thin delegate.
- [ ] R3. Copy only regular files directly under the worktree's `.spur/run/` that this task file cites, with a fixed maximum file count and safe single-component names. No wholesale directory copy or path traversal.
- [ ] R4. Existing target evidence is never overwritten on a byte conflict; a conflict on a cited file is reported and blocks teardown. Byte-identical copies remain no-ops.
- [ ] R5. A known task-lifecycle or feature-lifecycle row with no two-file run record no longer aborts persistence: source ENOENT is reported as `record-missing:<file>`, its inserted DB row still counts in `persisted`. A missing pipeline run record, unreadable DB, unsafe id, or unwritable target remains fatal.
- [ ] R6. Regression coverage exercises cited-artifact survival, missing-artifact refusal, a record-less lifecycle row beside a normal run, and conflict/idempotence reporting.

### Acceptance Criteria

- [ ] AC1 — Cited pipeline evidence survives worktree teardown, while missing cited evidence prevents teardown (req: R1, R2, R3)
- [ ] AC2 — Copying is WBS-bounded, idempotent, and never overwrites a conflicting target file (req: R3, R4)
- [ ] AC3 — A record-less lifecycle row is reported without aborting a normal run's transfer; fatal paths stay fatal (req: R5, R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The worktree driver already knows the task it is integrating; pass its merged task-file path to `--persist-out` and then to `persistWorktreeRuns`. Read that one task file and collect its literal `.spur/run/<filename>` citations. Require a safe single-component filename, regular source file, and a fixed cap (initially 64 distinct cited files). For each citation, compare source and target: copy an absent target, treat identical bytes as an idempotent no-op, and report divergent bytes as a conflict without overwrite or teardown. A cited file absent from both trees, or an unsafe/over-cap citation, fails before teardown. This directly covers WBS artifacts and run-ID artifacts without a growing filename allow-list or copying unrelated files. Keep selection and safe-path rules in the app service; the plugin script only forwards the path.

The same app service transfers all run DB rows. A known task-lifecycle or feature-lifecycle row may have no `<runId>.md` or `<runId>.state.json`; catch source ENOENT for those workflow names only and report `record-missing:<file>`. A missing task-pipeline record remains fatal, preserving the green-run evidence guarantee. Keep the lifecycle row's DB insertion and count it in `persisted`; this skip describes a record file, not a skipped row. Other read/write errors remain fatal. This folds in 0979, which targeted the same persist-out owner.

### Plan

- [ ] Identify how the worktree driver resolves the current merged task-file path and forward it to persist-out.
- [ ] Copy only safe, capped `.spur/run/` files actually cited by that task; fail before teardown on unresolved citations.
- [ ] Tolerate source ENOENT only for known lifecycle rows, not pipeline runs; preserve row counts and fatal error behavior.
- [ ] Extend the persist-out tests with WBS and run-ID citations, missing citation, unsafe/over-cap citation, normal and record-less runs, target conflict, and unreadable DB/unsafe run id.
- [ ] Update the worktree isolation contract line and run focused tests plus `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Not yet implemented — capture only.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T07:12:22.662Z backlog → todo (system)

