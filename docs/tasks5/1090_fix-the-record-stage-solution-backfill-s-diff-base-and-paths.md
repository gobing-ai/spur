---
schema_version: 1
name: Fix the record-stage Solution backfill's diff base and pathspec
status: done
template: feature-impl
created_at: 2026-10-05T22:51:56.246Z
updated_at: "2026-10-06T05:11:28.401Z"
feature_id: H1

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1090-verdict.json
---

## 1090. Fix the record-stage Solution backfill's diff base and pathspec

### Background

Run 9e8af77d-3366-42d8-94f9-8abaf6ec002e (task 1089, E71) halted the `record` hop with
`GuardDeniedError: Lifecycle transition blocked: spur task check 1089 --as testing failed —
L3.solution-file-line [Solution]: Solution must contain at least one file:line citation`, and the
backfill it ran in the same invocation had written:

    Change-map (auto-generated — implement step did not record a Solution).
    | `(no changes detected)` |

Root cause, read from the source: `packages/app/src/services/task-record.ts:804-811` builds the
`--solution-from-diff` input with

    git diff -U0 HEAD -- '*.ts' '*.tsx' '*.js'

which makes the safety-net backfill a no-op in two independent cases:

- **Committed work is invisible.** The diff base is the working tree vs `HEAD`, so anything the run
  already committed contributes nothing. That is the *documented* `--worktree` flow: WT-3b commits
  the batch's writes before WT-4, and the implement stage's own commits land the same way. The run
  above had five commits (`b6107a373`, `ad895ed51`, `68bf13242`, `54abbe0d9`, `bbfaae312`) and the
  backfill still reported "no changes detected".
- **Non-JS changes are invisible.** The pathspec admits only `*.ts`/`*.tsx`/`*.js`, so a
  documentation, corpus, YAML, SQL or Markdown-only task yields an empty backfill by construction —
  the gate then denies with an `L3` finding about the *Solution*, not about the backfill.

The consequence is doubly misleading. The author is told their Solution is malformed when the real
condition is an empty backfill; and because the pipeline's own `implement` hop is contractually the
Solution writer, a run that relies on the fallback discovers the gap only at the `record → testing`
guard, after the quality gate, review and verification have all been spent. The `L4.anchor-subject-mismatch`
and `L4.anchor-unresolved` rules additionally mean a hand-authored row must cite a real `file:line`,
so the denial cannot be satisfied by prose.

Observed in the same session: authoritative recovery was to author `## Solution` by hand through
`spur task update --section Solution --from-file`, after which `spur task record` succeeded with
`solutionBackfilled: false` (the authored body is preserved — the backfill is fallback-only, so
fixing it cannot overwrite an authored change-map).

Out of scope: the `implement` stage's primary responsibility to write Solution, and the
`requireDiff` guard, which reads a pre-action snapshot rather than this diff.

### Requirements

- [x] R1. The `--solution-from-diff` backfill names the files a run changed even when those changes
      are already committed: its diff base is the invocation's run base, not the working tree
      (`packages/app/src/services/task-record.ts:804-811`).
- [x] R2. The backfill covers every changed tracked file it is expected to describe, not only
      `*.ts`/`*.tsx`/`*.js` — a documentation, YAML or corpus-only task must produce rows too.
- [x] R3. When the backfill still finds nothing (a genuinely empty diff, or no resolvable base), the
      denial distinguishes "the backfill produced no rows" from "no Solution was authored", so the
      `L3.solution-file-line` message stops misattributing the cause.
- [x] R4. The existing fallback-only contract is preserved: an authored `## Solution` is never
      overwritten, and `spur task record` without `--solution-from-diff` is unchanged.

### Acceptance Criteria

- [x] AC1 — A committed run's changes are named by the backfill (R1)
- [x] AC2 — A non-JS-only change set is named by the backfill (R2)
- [x] AC3 — An empty backfill reports its own cause, not a malformed Solution (R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Diff base (R1).** The run base already exists: the pipeline precheck writes
`.spur/run/<wbs>-base.sha` (`config/workflows/task-pipeline.yaml`, precheck `onEnter`, task 0950's
base-commit capture) precisely so residual scans stay anchored to one commit across a resumed run.
Resolve the base in this order and stop at the first that yields a commit: an explicit option on the
record call, `.spur/run/<wbs>-base.sha`, then `HEAD`. Diff `<base>` against the working tree so
uncommitted and committed work are both covered, and keep the command on the `ProcessExecutor` seam
(`packages/app/src/services/task-record.ts:805`, `no-direct-process-spawn`).

**Pathspec (R2).** Dropping the extension list entirely and filtering afterwards is the smaller
change to reason about than curating a longer allowlist: exclude the generated and ignored planes the
row set must not advertise (`.spur/**`, `docs/tasks*/**` status churn, lockfile noise) and keep the
existing per-file first-line anchors. Cap the row count as the current renderer does, and keep the
`file:line` shape the `L4` anchor rules expect — one citation per row, an existing file, an in-range
line.

**Message (R3).** The reconciliation path already knows whether it produced rows; thread that through
so the `L3.solution-file-line` denial names the empty backfill explicitly, and leave the "author a
Solution" wording for the case where no backfill was requested.

**Constraints.** No new public CLI surface: this is the existing `--solution-from-diff` flag and the
existing `spur task record` verb. `mutationPolicy` and the record-stage transition guards are
untouched, and no service seam moves.

**Verification direction.** Extend `packages/app/tests/services/task-record.test.ts`, which already
pins the `(no changes detected)` renderer (`:698`) — the new cases assert the *presence* of the
changed paths, so they fail against today's `git diff HEAD -- '*.ts'` base and pathspec.

### Plan

1. Failure list first, in `packages/app/tests/services/task-record.test.ts` (or its sibling fixtures),
   against a scratch git repository:
   (a) a change committed on the branch with a clean working tree is named by the backfill;
   (b) a Markdown/YAML-only change set is named;
   (c) a genuinely empty diff reports the backfill-specific cause, not `L3.solution-file-line`'s
   authoring message;
   (d) the no-base fallback preserves today's `HEAD` behavior, and an authored Solution is still
   preserved (`solutionBackfilled: false`).
2. R1 + R2 in `packages/app/src/services/task-record.ts`: resolve the base (explicit option →
   `.spur/run/<wbs>-base.sha` → `HEAD`), diff against the working tree, replace the extension
   allowlist with an exclude-and-filter pass.
3. R3: thread the empty-backfill signal into the denial text the CLI renders; keep the wording for a
   requested-but-empty backfill distinct from the no-backfill path.
4. Gates: targeted `packages/app` suite while iterating, then `bun run spur-check` once.
5. Receipt: the four cases above with their pasted output, plus one end-to-end `spur task record
   <wbs> --solution-from-diff --transition testing` run inside a worktree batch whose implement stage
   committed, showing rows instead of `(no changes detected)`.

### Solution

| Change (`file:line`) | What changed |
| --- | --- |
| `packages/app/src/services/task-record.ts:930` | `resolveDiffBase` — the resolution order: an explicit base, then the precheck's `.spur/run/<wbs>-base.sha` run-base capture, then `HEAD`; the captured revision is shape-checked and a malformed one falls back rather than poisoning the diff (R1) |
| `packages/app/src/services/task-record.ts:984` | `gitDiffU0` diffs the resolved base against the working tree instead of `HEAD`, so work a run already committed is named too; `--no-renames` keeps a pure rename visible; the run-base file is read through the ts-runtime FileSystem seam (R1) |
| `packages/app/src/services/task-record.ts:901` | `GitDiffU0Options` — the cwd/base/wbs/excludePaths seam the record service and the tests drive; the git call stays on the `BunSyncProcessExecutor` seam (no new spawn path) |
| `packages/app/src/services/task-record.ts:754` | `SOLUTION_EXCLUDED_PATHSPECS` and the derived `SOLUTION_EXCLUDE_PATHSPECS` — `.spur/` runtime state and lockfiles excluded by pathspec, replacing the `*.ts`/`*.tsx`/`*.js` allowlist that made every non-JS change set empty by construction (R2) |
| `packages/app/src/services/task-record.ts:771` | `isExcludedSolutionPath` — the same filter applied inside the pure renderer, plus the per-call exclusions, so a raw diff handed straight to `renderSolutionFromDiff` is filtered identically (R2) |
| `packages/app/src/services/task-record.ts:952` | `listUntrackedFiles` — an untracked new file has no index entry, so `git diff <base>` can never see it; `git ls-files --others` supplies the paths the renderer cites at `:1` |
| `packages/app/src/services/task-record.ts:813` | `renderSolutionFromDiff` accepts the untracked list and the per-call filter; the change-map no longer advertises the recording task's own file |
| `packages/app/src/services/task-record.ts:793` | `isEmptyRecordSolution` — recognizes record's own change-map carrying the no-rows row; the signal R3's denial reads |
| `packages/app/src/services/task-check.ts:884` | `isEmptyRecordSolution` drives the `L3.solution-file-line` wording: an empty backfill names its own cause, an unauthored Solution keeps the authoring message (R3) |
| `packages/app/src/services/task-service.ts:1530` | the backfill gate covers record's own stale map as well as a bare section, so a poisoned `(no changes detected)` body self-heals on the next record |
| `packages/app/src/services/task-service.ts:1538` | record passes the resolved context root, the run WBS and the recording task's own path into `gitDiffU0`; `RecordOptions.solutionDiffBase` supplies the explicit override without adding a CLI flag (R1) |
| `packages/app/tests/services/task-record.test.ts:1652` | the `task 1090` backfill cases over a scratch git repo: committed work on a clean tree, the run-base capture, explicit-base precedence, the fallback to `HEAD`, a Markdown/YAML-only change set, a corpus-only change set, and the exclusion filter (R1/R2) |
| `packages/app/tests/services/task-record.test.ts:1036` | R4: an authored `## Solution` is never overwritten and `solutionBackfilled` stays false |
| `packages/app/tests/services/task-record.test.ts:1055` | the self-heal counterpart: record's own stale map IS replaced, which is the widened gate's defining contrast with the row above |
| `packages/app/tests/services/task-record.test.ts:1776` | the follow-up cases: the cwd seam, the derived pathspecs, the malformed run-base fallback, the rename row, the untracked row, the structural empty-map test, and the self-file exclusion |
| `packages/app/tests/services/task-check.test.ts:930` | the denial-wording assertion: record's empty backfill must not be reported as a malformed Solution (R3) |
| `plugins/sp/tests/skill-structure.test.ts:885` | **out-of-scope repair (operator-approved)**: the R44 `code-verification` body baseline 35_076 → 35_468. Commit c95c625e2 (task 1091) grew that skill body without bumping the ratchet, leaving `main` red for every task run; the bump is the test's own documented mechanism |

**Deviation from the frozen Design (one, deliberate).** The Design's pathspec list also excluded `docs/tasks*/**` task-corpus churn. That exclusion was dropped: R2 requires a *corpus-only* change set to produce rows, and excluding the corpus would recreate a by-construction empty change-map for exactly the case AC2 names. Keeping the exclusion would also need a literal `docs/tasks…` prefix in the renderer, which the project's `no-hardcoded-planning-folder` rule rejects. The self-referential row that consequence produced is instead removed per-call, by excluding the recording task's own file only.

**Review follow-ups (1090's own review).** The 3 deferred P3 advisories and 5 P4 advisories were repaired in place rather than deferred to a new task: the widened gate above, the context-root threading, the derived pathspec list, the run-base shape check, the untracked-file scan, the `--no-renames` rename fix, the structural empty-map classification, and the self-file exclusion. Verified end-to-end through the CLI on a scratch repository: a poisoned `(no changes detected)` map re-records into real rows, with the untracked file named and no self-referential row.

The R4 contract is untouched: `spur task record` without `--solution-from-diff` behaves exactly as before, and an authored `## Solution` is never overwritten. No new CLI surface, no service seam moved.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:930-945` `resolveDiffBase` resolves an explicit base, then the precheck's `.spur/run/<wbs>-base.sha` run-base capture (shape-checked by `DIFF_BASE_RE`, a malformed capture falls through rather than poisoning the diff), then `HEAD`; `packages/app/src/services/task-record.ts:984-1009` `gitDiffU0` diffs that resolved base against the working tree (`git diff --no-renames -U0 <base> -- . <excludes>`) on the `BunSyncProcessExecutor` seam, so committed work is named; the explicit override is the internal `RecordOptions.solutionDiffBase` at `packages/app/src/services/task-record.ts:84`, forwarded at `packages/app/src/services/task-service.ts:1540`. Executable (fresh, this run): `packages/app/tests/services/task-record.test.ts:1653` (committed work on a clean tree named), `:1668` (run-base capture), `:1682` (explicit base wins), `:1696` (HEAD fallback) — suite 341 pass / 0 fail. |
| R2 | MET | `packages/app/src/services/task-record.ts:754` `SOLUTION_EXCLUDED_PATHSPECS` (`.spur/**` + lockfiles) replaces the `*.ts`/`*.tsx`/`*.js` allowlist, with the git pathspec form DERIVED at `:757` `SOLUTION_EXCLUDE_PATHSPECS` (one edit point); `packages/app/src/services/task-record.ts:771` `isExcludedSolutionPath` re-applies the same filter inside the pure renderer (`:826`, `:867`); `packages/app/src/services/task-record.ts:952` `listUntrackedFiles` names untracked new files `git diff <base>` cannot see. Executable (fresh, this run): `packages/app/tests/services/task-record.test.ts:1710` (Markdown+YAML-only), `:1731` (corpus-only), `:1745` (exclusion filter), `:1768` (raw-diff renderer filter), `:1890` (untracked file named) — 341 pass / 0 fail. |
| R3 | MET | `packages/app/src/services/task-record.ts:793-796` `isEmptyRecordSolution` is structural (compares against `renderSolutionFromDiff('')`, not substring matching) and is consumed only by the L3 branch at `packages/app/src/services/task-check.ts:884-885`, which emits "Solution backfill produced no rows…" (naming `.spur/run/<wbs>-base.sha` and the recovery) for record's own empty change-map and keeps the authoring wording otherwise. Executable (fresh, this run): `packages/app/tests/services/task-check.test.ts:927` (unauthored keeps "must contain at least one") and `:956-957` (empty backfill names its cause AND asserts the authoring phrase is absent) — 341 pass / 0 fail. |
| R4 | MET | `packages/app/src/services/task-service.ts:1530` gates the backfill on `sectionIsBare(doc, 'Solution')` OR record's own stale map (`isRecordAuthoredSolution` — the widened self-heal gate), so an authored body is never replaced and `gitDiffU0` is unreachable without `--solution-from-diff`; no CLI flag was added (`apps/cli/src/commands/task.ts:1255` declares only the pre-existing `--solution-from-diff`; the record call at `:1287-1292` forwards no base option). Executable (fresh, this run): `packages/app/tests/services/task-record.test.ts:1036` (authored Solution byte-identical, `solutionBackfilled === false`) and `:1055` (record's own stale map IS replaced — the defining contrast) — 341 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:1653` — a change committed on the branch with a clean working tree is named by the backfill (asserts its own clean-tree premise and rejects the no-changes row; fails against the old `HEAD` base). Re-run green this run (341 pass / 0 fail); corroborated by the pipeline pass's live E2E receipt transcribed in `docs/tasks5/1090_fix-the-record-stage-solution-backfill-s-diff-base-and-paths.md` Testing (real `spur task record 0001 --solution-from-diff` on a scratch repo -> five rows, `solutionBackfilled: true`). |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts:1710` (Markdown + YAML change set named) and `:1731` (task-corpus-only change set produces rows) — both fail against the old extension allowlist. Re-run green this run (341 pass / 0 fail). |
| AC3 | MET | test | `packages/app/tests/services/task-check.test.ts:956-957` feeds the real `renderSolutionFromDiff('')` output through `TaskCheckService.check` and asserts the `L3.solution-file-line` message contains "backfill produced no rows" and NOT "must contain at least one". Re-run green this run (341 pass / 0 fail). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1090

**Scope:** `68e377a88..worktree` on `sp/run-1090-ada5a36c` — 7 files (5 code/test + `plugins/sp/tests/skill-structure.test.ts` + this task's corpus file); 376 insertions / 21 deletions. Diff artifact: `.spur/run/1090-review-diff.patch`.
**Dimensions:** functional traceability, SECUA (security, efficiency, correctness, usability, architecture), architecture depth.
**Verdict:** PASS — no P1, no P2.

Independent review: a fresh-context native subagent (`reviewer`, read-only) was dispatched for this stage under the `/sp:dev-review --tasks 1090 --auto` contract; it returned the findings below with `file:line` evidence and no pre-rated severity. The coordinator wrote this section. A `## Solution` accuracy defect the reviewer found (row 4) was corrected in the corpus before this section was written.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | A `## Solution` poisoned by the *old* backfill cannot self-heal: the fixed backfill still runs only when `sectionIsBare` is true, which is false for the `(no changes detected)` body the pre-fix code wrote — so task 1089's state is only recoverable by hand-authoring. The sibling precedent does allow replacing record's own output (`sectionIsBare(doc,'Review') \|\| isRecordAuthoredReview(...)`). | `packages/app/src/services/task-service.ts:1522`; `task-record.ts:759-771` | RESOLVED — repaired in place post-review (commit dff5455c7 dropped follow-up 1092): the gate is widened to `sectionIsBare(...) || isRecordAuthoredSolution(...)` at `packages/app/src/services/task-service.ts:1530`, so a poisoned `(no changes detected)` map self-heals on re-record; pinning tests `packages/app/tests/services/task-record.test.ts:1055` and `:1786`. R4's letter is preserved — an authored body is still never replaced (`:1036`). |
| 2 | P3 (minor) | correctness | `resolveDiffBase` builds its own FS and resolves the run dir from `process.cwd()` instead of the injected context root, so under the programmatic `main(argv, { cwd })` seam the base file would be read from — and `git diff` run in — the runner's repo. Latent: the sole production caller never sets `cwd`. | `packages/app/src/services/task-record.ts:886-897`; `packages/app/src/services/task-service.ts:1523-1526` | RESOLVED — repaired in place: `resolveDiffBase` reads the base file from `options.cwd ?? process.cwd()` at `packages/app/src/services/task-record.ts:935` and `gitDiffU0` runs git in that cwd (`:1003`); the record stage passes the context root. Pinning test `packages/app/tests/services/task-record.test.ts:1806`. |
| 3 | P3 (minor) | correctness | The two hand-maintained copies of the exclusion set (git pathspec array and the renderer predicate/Set) must be edited together; drift makes the git layer and the pure renderer disagree silently. | `packages/app/src/services/task-record.ts:721-756` | RESOLVED — repaired in place: `SOLUTION_EXCLUDE_PATHSPECS` is derived from `SOLUTION_EXCLUDED_PATHSPECS` at `packages/app/src/services/task-record.ts:757` (one edit point); pinning test `packages/app/tests/services/task-record.test.ts:1824`. |
| 4 | P3 (minor) | correctness | This task's own `## Solution` claimed the exclusion set contained `docs/tasks*`, contradicting the shipped list and the deliberate deviation. Four citation line numbers had also drifted under formatting. | `docs/tasks5/1090_*.md` → `## Solution` | RESOLVED — `## Solution` rewritten before this section was written (anchors re-derived; the corpus-row deviation is now stated explicitly). |
| 5 | P4 (advisory) | correctness | The run-base file's content is not shape-validated, although the sibling consumer `task-diffstat.ts` requires `/^[0-9a-f]{7,40}$/i`. A malformed base makes `git diff` exit non-zero, which is swallowed into `''` → a silent empty change-map. | `packages/app/src/services/task-record.ts:886-897` vs `plugins/sp/scripts/task-diffstat.ts:191` | RESOLVED — repaired in place: the run-base capture is shape-checked by `DIFF_BASE_RE` (`/^[0-9a-f]{7,40}$/i`) at `packages/app/src/services/task-record.ts:916`/`:938`, a malformed capture falls through to `HEAD`; pinning test `packages/app/tests/services/task-record.test.ts:1835`. |
| 6 | P4 (advisory) | testability | `RecordOptions.solutionDiffBase` has no caller and no record-level test; precedence is exercised at the `gitDiffU0` level only. | `packages/app/src/services/task-service.ts:1524`; `packages/app/tests/services/task-record.test.ts:1650-1662` | RESOLVED — repaired in place: record-level plumbing test `packages/app/tests/services/task-record.test.ts:1853` drives `svc.record` with `solutionDiffBase` and asserts the explicit base reaches the diff. |
| 7 | P4 (advisory) | correctness | Rename-only and untracked-new-file change sets still produce no row (`git diff` emits no `+++ b/…` for a pure rename; untracked files are absent). Pre-existing and unchanged by R2's letter. | `packages/app/src/services/task-record.ts:806-835` | RESOLVED — repaired in place: `gitDiffU0` passes `--no-renames` (`packages/app/src/services/task-record.ts:993`) so a pure rename produces a row, and `listUntrackedFiles` (`:952`) names untracked new files; pinning tests `packages/app/tests/services/task-record.test.ts:1870` and `:1890`. |
| 8 | P4 (advisory) | correctness | `isEmptyRecordSolution` classifies by marker prefix + substring, so an authored body quoting both would get the backfill wording. Impact confined to the message; the body still fails L3 either way. | `packages/app/src/services/task-record.ts:759-771`; `task-check.ts:884` | RESOLVED — repaired in place: `isEmptyRecordSolution` is structural (compares against `renderSolutionFromDiff('')`) at `packages/app/src/services/task-record.ts:793-796`; pinning test `packages/app/tests/services/task-record.test.ts:1907`. |
| 9 | P4 (advisory) | architecture | A backfilled change-map now advertises the recording task's own corpus file (one self-referential row), because the Design's corpus exclusion was dropped. | `.spur/run/1090-diffstat.json`; `packages/app/src/services/task-record.ts:742-749` | RESOLVED — repaired in place: the recording task's own file is excluded per-call via `excludePaths` (`packages/app/src/services/task-service.ts:1541-1543`), so no self-referential row; pinning test `packages/app/tests/services/task-record.test.ts:1918`. |

`Disposition` is the residual-sweep contract: `RESOLVED`/`FIXED`/`DONE` closes a row, `DEFER(<reason>)` reclassifies a P3, and a bare P1–P3 row stays blocking. No row is left bare.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `resolveDiffBase` order explicit → `.spur/run/<wbs>-base.sha` → `HEAD` (`task-record.ts:886`); `gitDiffU0` diffs that base (`task-record.ts:910`). Tests: committed-on-clean-tree, run-base capture, explicit-base precedence, `HEAD` fallback (`packages/app/tests/services/task-record.test.ts:1622+`). Live proof: `.spur/run/1090-base.sha` = `68e377a88` and this run's own diffstat names 7 paths, where the old base named none. |
| R2 | MET | Extension allowlist replaced by `-- .` + pathspec excludes (`task-record.ts:742`), re-applied in the pure renderer (`:752`). Tests: Markdown+YAML, corpus-only, `.spur/`+lockfile exclusion, raw-diff filter. |
| R3 | MET | `isEmptyRecordSolution` (`task-record.ts:769`) drives the denial branch (`task-check.ts:884`); the unauthored path keeps the authoring wording. Both wordings pinned in `packages/app/tests/services/task-check.test.ts:922-958`. |
| R4 | MET | Backfill still gated on `sectionIsBare` (`task-service.ts:1522`); `gitDiffU0` is unreachable without `--solution-from-diff`; new preservation test asserts `solutionBackfilled: false` with a byte-identical body (`packages/app/tests/services/task-record.test.ts:1027`). No CLI flag added. |
| AC1 | MET | Committed run's changes named — committed-work test + this run's live diffstat (7 paths at the recorded base). |
| AC2 | MET | Non-JS-only set named — Markdown+YAML and corpus-only tests; live diffstat names `docs/tasks5/1090_*.md` and `plugins/sp/tests/skill-structure.test.ts`. |
| AC3 | MET | Empty backfill reports its own cause — `task-check.test.ts:930`; an empty `renderSolutionFromDiff('')` body yields "Solution backfill produced no rows…", not the authoring message. |

##### Verification the reviewer could not perform

The reviewing subagent is read-only: it could not re-run the changed suites or recompute the proof digest. The quality gate this review follows ran green at the same digest — `bun run spur-check`: 10207 pass / 0 fail, 596 files, 50 rules clean (`.spur/run/1090-test-gate.log`).

##### Residual risk

The dissenting detail is the *asymmetry* between defence layers: the git pathspec and the renderer predicate are duplicated (row 3), and the run-base content is unvalidated (row 5). Neither can produce a wrong gate outcome today — both degrade to an empty change-map, which R3's message now names — but both are drift-prone. The motivating failure (task 1089's poisoned change-map) is repaired *going forward* by R1/R2; an *already*-poisoned Solution still needs the hand-authoring path this task's Background documents (row 1). Nothing in this diff widens the record stage's mutation surface: an authored `## Solution` remains untouched, and `spur task record` without `--solution-from-diff` is unchanged.

##### Disposition

PASS with three deferred P3 advisories and one corpus correction. R1–R4 and AC1–AC3 are met and independently traceable; the two deliberate deviations from the frozen Design (dropping the corpus exclusion, and the out-of-scope R44 baseline bump) are both recorded and were both operator-approved. Six P4 advisories accepted as noted.

Named follow-ups (not filed — the pipeline's review stage never passes `--triage`; surfaced in the run report instead):

All three named follow-ups were applied in the same module post-review (commit dff5455c7 dropped the filed follow-up task 1092 as the wrong shape): the context root is threaded (rows 2, 6), the self-heal gate is widened (row 1), and the git excludes are derived with the run-base shape-validated (rows 3, 5). Every repair carries a pinning test (`packages/app/tests/services/task-record.test.ts:1776-1941`) and was re-verified green in the 1090 re-audit (341 pass / 0 fail across `task-record` + `task-check`).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T00:07:45.068Z backlog → todo (system)
- 2026-10-06T00:25:14.670Z todo → wip (system)
- 2026-10-06T01:22:25.701Z wip → testing (system)
- 2026-10-06T01:24:31.261Z testing → done (system)

