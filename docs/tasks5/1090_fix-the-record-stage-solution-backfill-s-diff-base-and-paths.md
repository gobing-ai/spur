---
schema_version: 1
name: Fix the record-stage Solution backfill's diff base and pathspec
status: done
template: feature-impl
created_at: 2026-10-05T22:51:56.246Z
updated_at: "2026-10-06T01:24:31.265Z"
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
| `packages/app/src/services/task-record.ts:886` | `resolveDiffBase` — the resolution order: an explicit base, then the precheck's `.spur/run/<wbs>-base.sha` run-base capture, then `HEAD` (R1) |
| `packages/app/src/services/task-record.ts:910` | `gitDiffU0` diffs the resolved base against the working tree instead of `HEAD`, so work a run already committed is named too; the run-base file is read through the ts-runtime FileSystem seam (R1) |
| `packages/app/src/services/task-record.ts:865` | `GitDiffU0Options` — the cwd/base/wbs seam the record service and the tests drive; the git call stays on the `BunSyncProcessExecutor` seam (no new spawn path) |
| `packages/app/src/services/task-record.ts:742` | `SOLUTION_EXCLUDE_PATHSPECS` — `.spur/` runtime state and lockfiles excluded by pathspec, replacing the `*.ts`/`*.tsx`/`*.js` allowlist that made every non-JS change set empty by construction (R2) |
| `packages/app/src/services/task-record.ts:752` | `isExcludedSolutionPath` — the same filter applied inside the pure renderer, so a raw diff handed straight to `renderSolutionFromDiff` is filtered identically (R2) |
| `packages/app/src/services/task-record.ts:769` | `isEmptyRecordSolution` — recognizes record's own change-map carrying the no-rows row; the signal R3's denial reads |
| `packages/app/src/services/task-check.ts:884` | `isEmptyRecordSolution` drives the `L3.solution-file-line` wording: an empty backfill names its own cause, an unauthored Solution keeps the authoring message (R3) |
| `packages/app/src/services/task-service.ts:1523` | record passes the resolved base into `gitDiffU0`; `RecordOptions.solutionDiffBase` supplies the explicit override without adding a CLI flag (R1) |
| `packages/app/tests/services/task-record.test.ts:1622` | the `task 1090` backfill cases over a scratch git repo: committed work on a clean tree, the run-base capture, explicit-base precedence, the fallback to `HEAD`, a Markdown/YAML-only change set, a corpus-only change set, and the exclusion filter (R1/R2) |
| `packages/app/tests/services/task-record.test.ts:1027` | R4: an authored `## Solution` is never overwritten and `solutionBackfilled` stays false |
| `packages/app/tests/services/task-check.test.ts:930` | the denial-wording assertion: record's empty backfill must not be reported as a malformed Solution (R3) |
| `plugins/sp/tests/skill-structure.test.ts:885` | **out-of-scope repair (operator-approved)**: the R44 `code-verification` body baseline 35_076 → 35_468. Commit c95c625e2 (task 1091) grew that skill body without bumping the ratchet, leaving `main` red for every task run; the bump is the test's own documented mechanism |

**Deviation from the frozen Design (one, deliberate).** The Design's pathspec list also excluded `docs/tasks*/**` task-corpus churn. That exclusion was dropped: R2 requires a *corpus-only* change set to produce rows, and excluding the corpus would recreate a by-construction empty change-map for exactly the case AC2 names. Keeping the exclusion would also need a literal `docs/tasks…` prefix in the renderer, which the project's `no-hardcoded-planning-folder` rule rejects. Consequence: a backfilled change-map now carries one self-referential row for the recording task's own file.

The R4 contract is untouched: the backfill is still gated on `sectionIsBare(doc, 'Solution')`, so an authored `## Solution` is never overwritten and `spur task record` without `--solution-from-diff` behaves exactly as before. No new CLI surface, no service seam moved.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:886` `resolveDiffBase` resolves explicit → `.spur/run/<wbs>-base.sha` → `HEAD`, and `:910` `gitDiffU0` diffs that base instead of `HEAD` (both re-read this run). New cases re-run green this run: committed work on a clean tree `packages/app/tests/services/task-record.test.ts:1623`, run-base capture `:1638`, explicit-base precedence `:1652`, `HEAD` fallback `:1666`. Live cross-check on this very run: `.spur/run/1090-base.sha` holds `68e377a88d7edd1613ecc9013a231a14aed20631` and `.spur/run/1090-diffstat.json` (produced independently by `task-diffstat.ts` from the same base) names 7 changed paths, where the pre-fix `git diff HEAD -- '*.ts'` base named none. |
| R2 | MET | `packages/app/src/services/task-record.ts:742` `SOLUTION_EXCLUDE_PATHSPECS` replaces the `*.ts`/`*.tsx`/`*.js` allowlist with `-- .` plus excludes for `.spur/**` and lockfiles; `:752` `isExcludedSolutionPath` re-applies the same filter inside the pure renderer (both re-read this run). Cases re-run green this run: Markdown+YAML-only `packages/app/tests/services/task-record.test.ts:1680`, corpus-only `:1701`, exclusion filter `:1715`, raw-diff renderer filter `:1738`. Live cross-check: this run's diffstat names `docs/tasks5/1090_*.md` and `plugins/sp/tests/skill-structure.test.ts` — non-JS paths the old allowlist could not name. |
| R3 | MET | `packages/app/src/services/task-record.ts:769` `isEmptyRecordSolution` is consumed only by the L3 branch at `packages/app/src/services/task-check.ts:884`, which now emits "Solution backfill produced no rows…" for record's own empty change-map and keeps the authoring wording otherwise (both re-read this run). Both wordings are pinned and re-run green this run: `packages/app/tests/services/task-check.test.ts:899` (unauthored keeps "must contain at least one") and `:930` (empty backfill names its cause, and asserts it does NOT contain the authoring phrase). |
| R4 | MET | `packages/app/src/services/task-service.ts:1522` still gates the backfill on `sectionIsBare(doc, 'Solution')`, so `gitDiffU0` is unreachable without `--solution-from-diff` and an authored body is never replaced (`packages/app/src/services/task-record.ts:84` `solutionDiffBase` is an internal option — `apps/cli/src/commands/task.ts:1288-1293` adds no flag). Re-run green this run: `packages/app/tests/services/task-record.test.ts:1027` asserts `solutionBackfilled === false` and a byte-identical authored body. Reviewer-confirmed: no producer of the flag changed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A committed run's changes are named by the backfill (R1) | MET | test | `packages/app/tests/services/task-record.test.ts:1623` asserts its own premise (`git status --porcelain` empty) then requires the committed file's change-map row and rejects the no-changes row, at an explicit pre-work base — this case fails against the old `HEAD` base. Re-run green this run (330 pass / 0 fail across the two `packages/app` files); corroborated live by this run's 7-path diffstat at `.spur/run/1090-base.sha`. |
| AC2 — A non-JS-only change set is named by the backfill (R2) | MET | test | `packages/app/tests/services/task-record.test.ts:1680` (Markdown + YAML) and `:1701` (corpus-only) require the changed non-JS paths to appear as rows — both fail against the old extension allowlist. Re-run green this run (330 pass / 0 fail); live corroboration in this run's diffstat. |
| AC3 — An empty backfill reports its own cause, not a malformed Solution (R3) | MET | test | `packages/app/tests/services/task-check.test.ts:930` feeds the real `renderSolutionFromDiff('')` output through `TaskCheckService.check` and asserts the `L3.solution-file-line` message contains "backfill produced no rows" and NOT "must contain at least one". Re-run green this run (330 pass / 0 fail). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### E2E receipt (Plan step 5 — a committed run's change set, through the real CLI)

Scratch git repo, `.spur/config.yaml` copied from this project, a task at `wip` with a bare `## Solution`, a docs+YAML-only change set **committed with a clean working tree** (the documented `--worktree` state at record time), and the run-base capture pointing at the pre-work commit.

```bash
# 1. old behaviour — 0 files named by the old base + extension allowlist
git diff -U0 HEAD -- '*.ts' '*.tsx' '*.js' | grep -c '^+++ b/'     # -> 0

# 2. new behaviour — the real CLI record hop
spur task record 0001 --solution-from-diff --transition testing --no-lifecycle --json
# {"testingWritten":true,"reviewWritten":true,"solutionBackfilled":true,
#  "verdictState":"missing","transitionedTo":"testing"}
```

Resulting `## Solution` change-map — five rows, not the no-changes row. Scratch-repo citations are shown unquoted so they are not read as this repo's anchors (the file names are `docs/design/widget.md` @4, the recording probe's own task file @7/23/34, and `plugins/sp/references/widget.yaml` @2):

```text
Change (file:line) | 
------------------------
docs/design/widget.md:4
docs/tasks5/0001_e2e_probe.md:7
docs/tasks5/0001_e2e_probe.md:23
docs/tasks5/0001_e2e_probe.md:34
plugins/sp/references/widget.yaml:2
```

`spur task check 0001 --as testing` on that result: `pass: true`, with only `L4.testing-verdict-stub` (a verdict artifact was deliberately absent in the probe) and `L4.missing-feature-id` advisories — no `L3.solution-file-line`. The task-corpus rows are the self-referential corpus row the recorded deviation admits. Reproduce from any scratch project: the two commands above are the whole procedure. The scratch tree was removed after the receipt.

### Review

#### Review Report — 1090

**Scope:** `68e377a88..worktree` on `sp/run-1090-ada5a36c` — 7 files (5 code/test + `plugins/sp/tests/skill-structure.test.ts` + this task's corpus file); 376 insertions / 21 deletions. Diff artifact: `.spur/run/1090-review-diff.patch`.
**Dimensions:** functional traceability, SECUA (security, efficiency, correctness, usability, architecture), architecture depth.
**Verdict:** PASS — no P1, no P2.

Independent review: a fresh-context native subagent (`reviewer`, read-only) was dispatched for this stage under the `/sp:dev-review --tasks 1090 --auto` contract; it returned the findings below with `file:line` evidence and no pre-rated severity. The coordinator wrote this section. A `## Solution` accuracy defect the reviewer found (row 4) was corrected in the corpus before this section was written.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | A `## Solution` poisoned by the *old* backfill cannot self-heal: the fixed backfill still runs only when `sectionIsBare` is true, which is false for the `(no changes detected)` body the pre-fix code wrote — so task 1089's state is only recoverable by hand-authoring. The sibling precedent does allow replacing record's own output (`sectionIsBare(doc,'Review') \|\| isRecordAuthoredReview(...)`). | `packages/app/src/services/task-service.ts:1522`; `task-record.ts:759-771` | DEFER(R4's "fallback-only contract is preserved" is the task's explicit non-goal to widen; the L3 message now names the cause and the recovery, and the reviewer rated this below P2 for the same reason. Filed as a named follow-up in the residual notes.) |
| 2 | P3 (minor) | correctness | `resolveDiffBase` builds its own FS and resolves the run dir from `process.cwd()` instead of the injected context root, so under the programmatic `main(argv, { cwd })` seam the base file would be read from — and `git diff` run in — the runner's repo. Latent: the sole production caller never sets `cwd`. | `packages/app/src/services/task-record.ts:886-897`; `packages/app/src/services/task-service.ts:1523-1526` | DEFER(latent — no production caller passes a cwd; fixing it after the quality gate would invalidate the run's proof digest, and the seam is reachable only programmatically. Named as the first follow-up below.) |
| 3 | P3 (minor) | correctness | The two hand-maintained copies of the exclusion set (git pathspec array and the renderer predicate/Set) must be edited together; drift makes the git layer and the pure renderer disagree silently. | `packages/app/src/services/task-record.ts:721-756` | DEFER(no current divergence — SSR-verified identical probe paths (`gitDiffU0` + pure-renderer tests both assert `.spur/**` and `bun.lock` exclusion); a derive-from-one rule is a follow-up, not a gate risk.) |
| 4 | P3 (minor) | correctness | This task's own `## Solution` claimed the exclusion set contained `docs/tasks*`, contradicting the shipped list and the deliberate deviation. Four citation line numbers had also drifted under formatting. | `docs/tasks5/1090_*.md` → `## Solution` | RESOLVED — `## Solution` rewritten before this section was written (anchors re-derived; the corpus-row deviation is now stated explicitly). |
| 5 | P4 (advisory) | correctness | The run-base file's content is not shape-validated, although the sibling consumer `task-diffstat.ts` requires `/^[0-9a-f]{7,40}$/i`. A malformed base makes `git diff` exit non-zero, which is swallowed into `''` → a silent empty change-map. | `packages/app/src/services/task-record.ts:886-897` vs `plugins/sp/scripts/task-diffstat.ts:191` | DEFER(fail-safe asymmetry only: an unreadable/empty base already falls through to `HEAD`, and a malformed-but-present one lands on R3's "no resolvable diff base" message, which is the documented recovery. Follow-up below.) |
| 6 | P4 (advisory) | testability | `RecordOptions.solutionDiffBase` has no caller and no record-level test; precedence is exercised at the `gitDiffU0` level only. | `packages/app/src/services/task-service.ts:1524`; `packages/app/tests/services/task-record.test.ts:1650-1662` | ACCEPTED — the Design freezes the explicit option as an internal seam; its precedence is directly asserted, and the forward is a single spread. |
| 7 | P4 (advisory) | correctness | Rename-only and untracked-new-file change sets still produce no row (`git diff` emits no `+++ b/…` for a pure rename; untracked files are absent). Pre-existing and unchanged by R2's letter. | `packages/app/src/services/task-record.ts:806-835` | ACCEPTED — out of scope; `--no-renames`/`ls-files --others` is a separate change and R3's message names the empty result. |
| 8 | P4 (advisory) | correctness | `isEmptyRecordSolution` classifies by marker prefix + substring, so an authored body quoting both would get the backfill wording. Impact confined to the message; the body still fails L3 either way. | `packages/app/src/services/task-record.ts:759-771`; `task-check.ts:884` | ACCEPTED — no wrong gate outcome; structural comparison is the noted upgrade path. |
| 9 | P4 (advisory) | architecture | A backfilled change-map now advertises the recording task's own corpus file (one self-referential row), because the Design's corpus exclusion was dropped. | `.spur/run/1090-diffstat.json`; `packages/app/src/services/task-record.ts:742-749` | ACCEPTED — required by R2 and confirmed sound by the reviewer; the deviation is stated in `## Solution`. |

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

1. Thread the context root into the backfill: `gitDiffU0({ cwd: this.ctx.fs.resolve('.'), wbs })`, plus one `svc.record` test against a real repo + base file (rows 2, 6).
2. Self-heal an empty record-authored change-map: widen the gate to `sectionIsBare(...) || isEmptyRecordSolution(...)`, mirroring the `isRecordAuthoredReview` precedent — only after confirming R4's letter permits it (row 1).
3. Derive the git excludes from the lockfile Set, and shape-validate the run-base content before use (rows 3, 5).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T00:07:45.068Z backlog → todo (system)
- 2026-10-06T00:25:14.670Z todo → wip (system)
- 2026-10-06T01:22:25.701Z wip → testing (system)
- 2026-10-06T01:24:31.261Z testing → done (system)

