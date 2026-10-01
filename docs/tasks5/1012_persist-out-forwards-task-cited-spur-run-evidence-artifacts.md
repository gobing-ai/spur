---
schema_version: 1
name: persist-out forwards task-cited .spur/run evidence artifacts
status: done
template: feature-impl
created_at: 2026-09-29T18:18:18.307Z
updated_at: "2026-10-01T07:07:11.953Z"
feature_id: A9

ac_altitude: task-local
dependencies: ["0975", "0984"]
priority: P2
estimate_hours: 3
---

## 1012. persist-out forwards task-cited .spur/run evidence artifacts

### Background

Observed during run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600 (task 1008, single-task `--worktree` WT-4 finish per 0975 R1, `--task-file` per 0984 R2): persist-out copied the run record (`<runId>.state.json` + `<runId>.md`) and nothing else; `1008-verdict.json`, `1008-test-gate.log/.status`, `1008-precheck-*.status`, `1008-residuals.json`, `1008-diffstat.json`, `<runId>-*.status/.txt/.digest` were hand-copied before `git worktree remove`.

**Verification (2026-09-29) — the original diagnosis was wrong.** Task-cited evidence forwarding already shipped in 0984 (2026-09-27, commits 9e131b141 / a77b28028 / fd0a81872): `persistWorktreeRuns` (`packages/app/src/services/inline-run-setup.ts:252+`) scans each `--task-file` for literal `.spur/run/<file>` citations and copies/verifies them, fail-closed. It did not fire because the 1008 task file cites exactly one run path (`.spur/run/785c3ca9-…-review-answer.txt`); its Testing section says "Verdict: PASS (from verdict artifact)" with no path. The real gap: **run-owned evidence that the task file does not cite by path dies with the worktree.** The docs already promise otherwise — `plugins/sp/skills/spur-dev/references/execution-batch.md:1117` says "WT-4a persists [`<wbs>-verdict.json`] into the invoking tree", which is only true when the verdict happens to be cited. The batch-level verdict copy (`execution-batch.md:484`) does not cover single-task `/sp:dev-run --worktree`.

The original R1 (citation scan + `--evidence` flag in the script) duplicates 0984, and the original R2 (conflict → report and continue; missing → warning) would regress 0984 R1/R4 fail-closed guarantees. Both are replaced below. (Task name predates this correction; scope is "run-owned", not "task-cited".)

**Refine corrections (2026-09-30)**

- The main owned-evidence fix is no longer absent: existing uncommitted changes in the app service, its integration tests, generated plugin bundle and execution-batch reference already implement it. Preserve and finish those changes rather than implementing the ownership pass again.
- A remaining defect is reproducible at `packages/app/src/services/inline-run-setup.ts:322`: `readdir(...).catch(() => [])` swallows ENOTDIR and other listing failures. A real fixture with a valid source DB, no run rows, an unciting task file and a regular file at source `.spur/run` returned `{ok:true,persisted:0,skipped:[]}` and created the target DB. Listing failures must fail before target writes; only ENOENT means no owned directory.
- Existing focused integration suite ran on 2026-09-30: 20 pass, 0 fail, including ownership, conflict, idempotence and cap scenarios. These do not cover enumeration failure or the portable script path for uncited owned files.
- The source DB opener is migrated/read-write (`openInlineRunProjectDb`), not read-only. Zero-write guarantees here apply to the invoking tree during prevalidation, not source DB migrations or every possible late I/O failure.
- Ownership does not cover every possible pipeline filename. Scope is exactly the union of literal citations and WBS/run-row prefixes, with explicit two-file record exclusions. All source run rows contribute prefixes, including rows for other tasks; do not claim that all other-task artifacts are excluded.
- Historical task-1008 observation is retained as reported provenance, not independently re-established here. Current validity rests on source inspection and the deterministic ENOTDIR reproduction.
- Planning content previously placed in Solution belongs in Design/Plan. Solution is replaced with an explicit pre-existing-change note and file citations; no completed implementation is claimed.

### Requirements

- [x] R1. With nonempty `taskFiles`, preserve forwarding of source `.spur/run/` direct children selected by each task basename's leading four digits followed by `_` (`<wbs>-` prefix), or each safe source DB run ID (`<runId>-` prefix), alongside literal citations. Uncited two-file run records remain owned by the existing record-transfer path; regular evidence copies/no-ops/refusals and nonregular `cited-<kind>` skips retain existing behavior.
- [x] R2. Preserve the 64-name cap over the deduplicated union and validation before invoking-tree writes. Pre-existing byte conflicts, unreadable forwarded task files, unresolved citations, unsafe source run IDs and over-cap unions fail before target DB creation or mutation. Missing taskFiles and an empty array retain the legacy rows/records-only path. This is prevalidation safety, not a transaction across all late DB/file failures.
- [x] R3. The execution-batch reference accurately describes selection, union cap, exclusions, conflicts and enumeration failures. State that run prefixes come from all source run rows; unrelated files matching neither citations nor an ownership prefix are excluded.
- [x] R4. Source evidence-directory enumeration tolerates ENOENT only; ENOTDIR, EACCES and other errors propagate before any invoking-tree write. The persist-out wrapper returns exit 1 and `{ok:false,error:...}` for these failures so WT-5 retains the worktree.
- [x] R5. Real filesystem/DB integration and portable plugin subprocess checks demonstrate uncited evidence survival, prevalidation refusal and unchanged legacy behavior. Record repeatable command results in the eventual Testing section.

Non-goals: new flags or public CLI commands; copying the entire directory; changing run-record collision semantics; changing `--close`; redesigning DB opening/transactions; changing the fixed cap or expanding filename ownership; unrelated pre-existing edits. Implementation is a minimal completion of existing changes, not a second ownership mechanism.

### Acceptance Criteria

- [x] AC1 — Uncited owned evidence survives and unrelated evidence is excluded (req: R1, R5)
  Given a real source DB run and `1234_x.md` without citations, when persistence runs, `1234-verdict.json` and `<runId>-route-reason.txt` arrive with identical bytes, while `9999-verdict.json` without a matching run prefix does not. Repeating persistence preserves bytes. Observe in `packages/app/tests/services/persist-worktree-runs.test.ts`.
- [x] AC2 — Owned conflict and union overflow fail before target writes (req: R2, R5)
  Given a divergent owned target, persistence rejects and preserves that target, copies no queued artifact and inserts no run rows. A distinct cited-only name plus 64 owned names rejects over-cap; a cited name also selected by ownership counts once. Use real fixtures in `packages/app/tests/services/persist-worktree-runs.test.ts`, preserving the existing 65-owned case.
- [x] AC3 — Omitted and empty taskFiles preserve legacy behavior (req: R2, R5)
  For both omitted taskFiles and `[]`, only rows and two-file records transfer; uncited owned files remain absent at target. Observe in `packages/app/tests/services/persist-worktree-runs.test.ts`.
- [x] AC4 — Invalid evidence directory fails closed and absence remains supported (req: R4, R5)
  Given an already migrated valid source DB with zero run rows and a source `.spur/run` regular file, persistence rejects ENOTDIR and does not create target `.spur`. With that path absent (ENOENT), the same unciting-task fixture succeeds. Observe in `packages/app/tests/services/persist-worktree-runs.test.ts`; do not rely on permission bits, which can vary by runner.
- [x] AC5 — Portable persist-out observes owned evidence and enumeration failure (req: R1, R4, R5)
  Through the existing subprocess helper in `plugins/sp/tests/inline-run-setup.test.ts`, the checked-in portable script plus generated bundle copies uncited WBS/run-ID evidence when given `--task-file`. An ENOTDIR source fixture exits 1 with `{ok:false,error:...}` and leaves target `.spur` absent. Save command output as the repeatable receipt; no mock of the persistence service.
- [x] AC6 — Worktree documentation matches the completed contract (req: R3)
  Review `plugins/sp/skills/spur-dev/references/execution-batch.md` against implementation: exact ownership prefixes, all-source-row scope, exclusions, union cap, ENOENT-only tolerance and failure-to-WT-5 behavior. Run its existing contract tests.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T19:53:34.329Z

- **Q: Keep, drop or rewrite?** Closed 2026-09-29: rewrite. The observed loss is real; the proposed mechanism already exists (0984) and the proposed conflict semantics would weaken it.
- **Q: Ownership rule?** Closed: filename prefix `<wbs>-` / `<runId>-`. It matches every artifact the pipeline writes (`<wbs>-verdict.json`, `<wbs>-test-gate.*`, `<runId>-*.status`), is deterministic, and stays bounded — no whole-directory copy.
- **Q: Divergent owned file in the target (e.g. a stale `<wbs>-verdict.json` from an earlier non-worktree run)?** Closed: fail closed, same as 0984 R4. Consequence: the operator reconciles by hand and the worktree is retained — accepted, because "a green run can never destroy its own evidence" outranks convenience. Revisit only if this proves frequent.
- **Q: `--evidence <path>` flag?** Closed: dropped (YAGNI; ownership rule + citations cover it; also avoids a script-surface change).
- **Q: Implement in the script?** Closed: no — the script owns no persistence policy (`inline-run-setup.ts` header); the change lives in the app service, and the generated bundle is rebuilt.

#### Q&A entry — 2026-09-30T13:36:00.062Z

- **Q: Remove the task because the main fix exists?** Closed 2026-09-30: retain. The existing ownership changes are uncommitted, and a deterministic enumeration-error regression remains. Scope is completion and verification, not duplicate implementation.
- **Q: What listing errors mean an empty evidence set?** Closed: only ENOENT. Other errors reject before invoking-tree writes; ENOTDIR supplies a repeatable failure test independent of runner permissions.
- **Q: Is the source DB read-only or persistence globally atomic?** Closed: neither. Preserve the existing migrated source opener and limit zero-write claims to invoking-tree prevalidation. Transactional redesign is outside this task.
- **Q: Does filename ownership cover every pipeline artifact or exclude every other task's evidence?** Closed: no; it covers literal citations plus the defined prefixes, and every source run row supplies a prefix. Document that exact contract.

### Design

Minimal completion of the existing change in `persistWorktreeRuns` (`packages/app/src/services/inline-run-setup.ts`): only when `taskFiles` is non-empty, the worktree's `.spur/run/` direct children named `<wbs>-…` (WBS = leading four digits before `_` of each forwarded task file basename) or `<runId>-…` (every source `runs` row) join the existing `citedNames` set before classification, then ride the unchanged 0984 pipeline (copy / byte-identical no-op / divergent throw / `cited-<kind>` skip) under the same `MAX_CITED_RUN_FILES` cap over the deduplicated union.

- Invariant: enumeration (short-lived source DB open + `readdir`) completes before any invoking-tree write; unsafe run ids reject with `InvalidWorkflowRunIdError`. The source opener is migrated/read-write, so the guarantee is prevalidation safety for the invoking tree, not a transaction.
- `readdir` tolerates ENOENT only; every other listing error propagates (R4).
- `<runId>.md` / `<runId>.state.json` are excluded — the record copy owns them.
- No flag, usage, record-format or `--close` change; omitted or empty `taskFiles` keeps the legacy path.
- Tradeoff: the source DB is opened twice rather than hoisting the transfer block — smaller diff.

### Plan

- [x] Failing integration tests first: ownership, conflict, legacy path, cap, union cap, empty array, ENOTDIR/ENOENT.
- [x] Enumerate owned names into `citedNames`; ENOENT-only `readdir` tolerance; JSDoc.
- [x] Portable subprocess tests for uncited evidence and ENOTDIR.
- [x] Correct `execution-batch.md`; `bun run build:plugin-lib`; `bun run plugin-smoke`.

### Solution

Finished the existing owned-evidence change; no second mechanism added.

1. `packages/app/src/services/inline-run-setup.ts:303-340` — with non-empty `taskFiles`: WBS prefixes from each task basename, run-id prefixes from every source run row (unsafe ids rejected), sorted `readdir` of the source `.spur/run/` adds matching names to `citedNames`, skipping the two-file records, capped over the union.
2. `packages/app/src/services/inline-run-setup.ts:324-329` — R4 fix: `readdir` tolerates ENOENT only; ENOTDIR/EACCES and other errors propagate before any invoking-tree write. The wrapper script needed no change — its existing catch prints `{ok:false,error}` and exits 1.
3. `packages/app/tests/services/persist-worktree-runs.test.ts:467` — seven integration tests on real temp trees and DBs; `plugins/sp/tests/inline-run-setup.test.ts:774` and `plugins/sp/tests/inline-run-setup.test.ts:799` — two subprocess tests of the checked-in portable script plus generated bundle.
4. `bun run build:plugin-lib` regenerated `plugins/sp/lib/inline-run.generated.mjs`.
5. `plugins/sp/skills/spur-dev/references/execution-batch.md:511-521` — ownership prefixes, all-source-row scope, record exclusion, union cap, ENOENT-only tolerance, WT-5 on failure.

Deviations: none from the refined requirements. The source DB is opened twice (enumeration, then transfer) instead of hoisting the transfer block.

Tests were written before the code they cover: the ownership tests failed 3/20 before the enumeration existed, and the ENOTDIR tests failed in both suites before the ENOENT-only change.

Re-verification 2026-09-30: CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 37 pass and portable tests: 24 pass, both exit 0.

Re-verification 2026-09-30: Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:315`; `packages/app/tests/services/persist-worktree-runs.test.ts:481` — reviewed implementation of R1. With nonempty `taskFiles`, preserve forwarding of source `.spur/run/` direct children selected by each task basename's leading four digits followed by `_` (`<wbs>-` prefix), or each safe source DB run ID (`<runId>-` prefix), alongside literal citations. Uncited two-file run records remain owned by the existing record-transfer path; regular evid. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| R2 | MET | `packages/app/tests/services/persist-worktree-runs.test.ts:513` — reviewed implementation of R2. Preserve the 64-name cap over the deduplicated union and validation before invoking-tree writes. Pre-existing byte conflicts, unreadable forwarded task files, unresolved citations, unsafe source run IDs and over-cap unions fail before target DB creation or mutation. Missing taskFiles and an empty array retain the legacy rows/records-only path. . Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:515` — reviewed implementation of R3. The execution-batch reference accurately describes selection, union cap, exclusions, conflicts and enumeration failures. State that run prefixes come from all source run rows; unrelated files matching neither citations nor an ownership prefix are excluded.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| R4 | MET | `packages/app/src/services/inline-run-setup.ts:338`; `packages/app/tests/services/persist-worktree-runs.test.ts:715`; `plugins/sp/tests/inline-run-setup.test.ts:799` — reviewed implementation of R4. Source evidence-directory enumeration tolerates ENOENT only; ENOTDIR, EACCES and other errors propagate before any invoking-tree write. The persist-out wrapper returns exit 1 and `{ok:false,error:...}` for these failures so WT-5 retains the worktree.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| R5 | MET | — reviewed implementation of R5. Real filesystem/DB integration and portable plugin subprocess checks demonstrate uncited evidence survival, prevalidation refusal and unchanged legacy behavior. Record repeatable command results in the eventual Testing section.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:481` — source/contract review of AC1. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| AC2 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:513` — source/contract review of AC2. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| AC3 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:571` — source/contract review of AC3. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| AC4 | MET | test | `packages/app/tests/services/persist-worktree-runs.test.ts:715` — source/contract review of AC4. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| AC5 | MET | test | `plugins/sp/tests/inline-run-setup.test.ts:774` — source/contract review of AC5. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
| AC6 | MET | test | `plugins/sp/skills/spur-dev/references/execution-batch.md:515`; `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:182` — source/contract review of AC6. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-verification 2026-09-30: requirement and AC traceability, correctness, security, efficiency, usability, maintainability, architecture, Design and scope checked against current task-owned code and executable tests.

Destination symlinks/non-files now reject before cited/owned evidence writes; existing target read errors propagate, and exclusive-create writes prevent overwrites. Red/green dangling-symlink regression: .spur/run/A9-reverify/1012-symlink-red.log and 1012-symlink-green.log. CHANGED: the original union cap was explicitly superseded by task 1034 per-owner cap; cited owned files now count in each owner budget. Fresh persist/driver tests: 38 pass and portable tests: 24 pass, both exit 0.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | SECUA and architecture | task-owned implementation | No findings (verify verdict PASS) |

### References

- Upstream completed contracts: tasks 0975 and 0984; owning feature A9; current task has task-local AC.
- Primary implementation: `packages/app/src/services/inline-run-setup.ts:272`, ownership at :298, faulty catch at :322, wrapper at :1160. Source opener at :154 is migrated/read-write.
- Existing checks: `packages/app/tests/services/persist-worktree-runs.test.ts:467`; portable script tests `plugins/sp/tests/inline-run-setup.test.ts:619`; generated bundle `plugins/sp/lib/inline-run.generated.mjs`; documentation `plugins/sp/skills/spur-dev/references/execution-batch.md:511`.
- 2026-09-30 audit: focused suite 20 pass / 0 fail; one main worktree, no wip tasks; existing uncommitted ownership changes must be preserved. Historical task-1008 run report was not independently re-established.
- Refinement evidence and all seven ready-checklist rows: `.spur/run/1012-refine-readiness.md`. No product implementation or full implementation gates executed during refinement.

### History

- 2026-09-30T13:35:35.888Z backlog → todo (system)
- 2026-09-30T13:35:36.250Z todo → wip (system)
- 2026-09-30T13:43:16.709Z wip → testing (system)
- 2026-09-30T13:45:45.175Z testing → done (system)

