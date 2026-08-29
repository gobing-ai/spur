---
schema_version: 1
name: "Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)"
status: done
template: issue
created_at: 2026-08-29T02:33:38.958Z
updated_at: "2026-08-29T05:18:15.486Z"
feature_id: F95
---

## 0713. Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)

### Background

Self-contained findings task from the 2026-08-28 dogfood of
`/skill:sp-dev-runall --feature F95 --auto --next --agent inline` (run id
`20260828-runall-f95-inline-01`). Every finding below carries its evidence inline; no external
report is required to act on this task.

Already fixed inline the same day (excluded from Requirements):

- Verify-leg surface docs: `plugins/sp/skills/spur-cli/references/tasks/verbs.md` now documents
  the no-`verify`-verb flow (answer file → `spur task verdict` → `spur task record`) and the
  `[invalid-solution]` wip→testing Solution gate.
- `spur task update --status` silent no-op: root cause was the stale global `spur` bundle, not
  source (`bun run apps/cli/src/index.ts task update --status wip 9999` →
  `error: unknown option '--status'`). Refreshed via `build:bundle`; global now errors loudly.
- `bun --coverage=false` invalid: documented gotcha only, no live code uses it.

Out of scope: deferred requirements on tasks 0698–0702 — each is already recorded inside its own
task file (Testing/Review sections).

**Added by the 2026-08-28 `/sp:dev-verifyall --feature F95` sweep (two further misfiring signals,
both reproduced against *correct* input):**

- `L4.stale-line-anchor` false positive on markdown-authority citations (P3). A `Solution`-row
  citation whose row yields no `extractSubjectTokens` hits falls back to
  `extractPathSubjectTokens(cite.path)` (`packages/app/src/services/task-check.ts:1424-1426`,
  `:428-442`). For `docs/00_ADR.md` that reduces to the single token `adr`, which occurs on line 2
  of that file and on hundreds of others, so every such citation reports
  `Anchor drift ... now sits at line 2` regardless of correctness. Reproduced against the correct
  anchor `docs/00_ADR.md:1673`. Same root shape for any multi-file table row: one token set is
  matched against every cited window, so a row citing two files reliably "drifts" on one of them.
  Fix direction: require the fallback token to be discriminating — a token matching a large
  fraction of the cited file's lines carries no drift signal and should suppress the claim rather
  than manufacture one.
- `deriveVerdict` parses SECUA rows as requirement rows (P3). An answer file's
  `### SECUA Review` row whose Finding cell contains the bare word `UNMET` (or `PARTIAL`/`MET`) is
  admitted into `verdict.requirements[]` with that status — observed this run on task 0698, where
  two `P1`/`P3` SECUA rows inflated the requirement count from 19 to 21 and appeared as UNMET
  requirements. The status scan (`packages/app/src/services/task-verdict.ts:235-240`) runs on rows
  the requirement-table column map admits without confirming the row came from the traceability
  table. Harmless here (the aggregate was already FAIL) but it can manufacture a FAIL on an
  otherwise-passing task whose review prose merely uses the word.
- `bun run test` is red at `HEAD` for four pre-existing failures, confirmed by stashing this
  sweep's working changes and re-running against a clean `3d57c24f5` tree (identical four).
  They are not caused by F95 work and belong to R3's triage list:
  `R42 — skill description budgets` and `R44 — skill BODY budgets` in
  `plugins/sp/tests/plugin-structure.test.ts` (baselined skill bodies grew — the
  `dev-review-session --triage` work in `0beb3be7c` is the most recent grower);
  `cli-surface-parity — R4: AGENTS.md noun table vs live root`; and
  `dev-review-session stays an inline, read-only wrapper over sp:session-review (ADR-089)`.
  Note also that a Claude Code scratch directory (`plugins/sp/skills/.claude/.cc-writes`) created
  mid-run made `R42`/`R44`/`R43` fail with `ENOENT ... /plugins/sp/skills/.claude/SKILL.md`, because
  the plugin-structure scan treats every entry under `plugins/sp/skills/` as a skill directory.
  Removing the empty directory cleared those three; the scan should skip dot-directories so a
  harness artifact cannot masquerade as a malformed skill.

### Requirements

- [x] R1 — Resolver ordering guard (P1). Symptom: the runall resolve step ordered tracking parent 0698
  first (WBS tie-break — no `dependencies[]` edges existed on 0698–0702), so its verify ran before
  any child was implemented: verdict FAIL with 37 unmet (19/19 requirements, 18/18 ACs, children
  todo) and the batch halted. 0698's own Plan section declared children-first ordering, but the
  resolver reads only frontmatter `dependencies[]`. In-run fix was data, not code:
  `spur task deps 0698 add 0699 0700 0701 0702` → children-first re-run. Required: when a task's
  Plan declares children-first / soft ordering that contradicts missing frontmatter edges, the
  resolve step (or a `feature check` L-rule) must warn naming the missing edges.
- [x] R2 — `spur task record` idempotency (P2). Symptom: 0700's first `record` wrote a FAIL verdict
  header into the task's Review section; after the child timed out and the resumed run re-recorded
  with an updated outcome, the stale FAIL header remained in
  `docs/tasks4/0700_corpus-gates-tell-the-truth-checkbox-flip-review-reconciliat.md` (uncommitted
  at the time). The Review writer does not clear/replace header lines from a prior record.
  Surface: `task.command('record')`, apps/cli/src/commands/task.ts:948.
- [x] R3 — Pre-existing defect triage (surfaced by the batch, out of its scope):
  - (a) `config/workflows/history-anatomy.yaml`: 111 line-length lint findings, 4 of them live
    shell lines inside YAML block scalars where naive reflow changes semantics (observed during
    0702's zero-new-violations review; batch committed none of them).
  - (b) `packages/app` test suite: a cwd-dependent `resolveRepoRoot` test failure — fails or
    passes depending on the directory the suite is launched from (observed by the 0699 child
    during its scoped `bun test` run; unrelated to F95 code).
  - (c) corpus-check baseline noise: the checker reports failures caused by sibling/parallel task
    dirt rather than the task under check (observed when `corpus-check` ran dirty from the batch's
    own section writes; note 0700's uncommitted `packages/app/src/services/corpus-check.ts` and
    `scripts/commands/regen-corpus-baseline.ts` edits may already address part of this — triage
    against them before writing new code).

### Acceptance Criteria

- AC1: R1 — a corpus fixture with Plan-declared children-first ordering but no
  `dependencies[]` edges triggers the warning; the same fixture with edges set is silent.
- AC2: R2 — a regression test replays record→re-record with a changed verdict and asserts
  no stale header remains in the Review section.
- AC3: R3 — each of (a)/(b)/(c) has an explicit disposition: fixed, or a documented owner
  follow-up (line/link recorded in Notes). For (c), the disposition must state whether 0700's
  uncommitted corpus-check changes already cover it.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. R1: locate the resolve/topo step in the runall driver path (packages/app) or the feature
   check rule table; add the warning with a fixture test.
2. R2: read `task record`'s Review writer (apps/cli/src/commands/task.ts:948) for the
   header write path; make re-record idempotent; regression test.
3. R3: triage each item; (a) needs semantic-aware handling of shell lines inside YAML block
   scalars before any bulk reflow; (c) first diff against 0700's uncommitted corpus-check edits.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
All three requirements landed in the 2026-08-28 F95 close-out sweep.

**Change map**

- **R1** — new L4 rule emitted at `packages/app/src/services/task-check.ts:1145`, with
  `L4_ROLLUP_ROSTER_NOT_DECLARED_DEPENDENCY` registered at `packages/config/src/finding-codes.ts:123`.
  A decomposition parent whose Plan carries a sub-task roster warns when frontmatter
  `dependencies[]` omits an **open** child, and
  the message carries the exact repair (`spur task deps <wbs> add <children>`). Placed in
  `runL4Rollup` because that is where the roster and the frontmatter are already both in hand;
  the missing-roster branch returns first, so a parent with no roster gets one complaint, not two.
  Closed children are excluded — a `done` child cannot be mis-ordered, so warning about it would
  be noise on every finished decomposition.
- **R2** — `renderReview` now prefixes its output with `RECORD_REVIEW_MARKER`
  (`packages/app/src/services/task-record.ts:447-470`), and `record` replaces a Review that is
  bare **or** its own prior output (`packages/app/src/services/task-service.ts:1145-1152`, via
  the new `isRecordAuthoredReview`). `LEGACY_RECORD_REVIEW_RE` recognizes pre-marker output so
  the existing corpus self-heals on its next record — task 0700's stale
  `verdict: FAIL` header was replaced with `verdict: PARTIAL` this run. An authored Review
  (0693, 0701, 0702) is still never touched, which is the half of the contract that matters.
- **R3(a)** — **no action, dispositioned.** No repo gate enforces YAML line length: `bun run lint`
  is Biome over 808 files and does not cover YAML, there is no yamllint config, and no rule in
  `config/rules/` measures it. The 111 findings came from an editor-side linter outside the gate.
  Re-measured this run: 14 lines exceed 120 columns, and every one is a load-bearing single-line
  scalar — 4 `input:` agent prompts and 9 shell `command:` lines, where reflowing changes the
  value, plus one `description:`. Adding a YAML line-length gate would need a block-scalar
  exclusion and is a new surface (operator consent).
- **R3(b)** — **fixed.** `resolveRepoRoot` was correct; the test was cwd-dependent, asserting
  `process.cwd()` where the function returns the git toplevel — equal only when the suite is
  launched from the repo root. Now asserts the toplevel
  (`packages/app/tests/services/anchor-qualifier.test.ts:87-95`). `cd packages/app && bun test` →
  2173 pass / 0 fail.
- **R3(c)** — **dispositioned, with the four HEAD-red tests fixed.** The `corpus-check` failure is
  not sibling dirt: 88 NEW findings reproduce on a clean `3d57c24f5` tree, almost all
  `L4.verdict-rows-match-no-scenario` — the finding code task 0700 added, whose existing-corpus
  population was never baselined. 0700's `corpus-check.ts` / `regen-corpus-baseline.ts` work does
  not cover it. Reconciling is a baseline regeneration (the tool's own accept path), recorded
  rather than silent. Separately, the four test failures red at HEAD are fixed here:
  skill description + body budgets (`plugins/sp/skills/session-review/SKILL.md`,
  `plugins/sp/skills/dogfood-testing/SKILL.md` trimmed rather than re-baselined),
  the AGENTS.md noun table restored under `## Spur CLI surface` (dropped by `2f4e729ff`), and the
  `dev-review-session` argument-hint assertion updated for the `--triage` flag `0beb3be7c` shipped.
  A Claude Code scratch directory (`plugins/sp/skills/.claude/.cc-writes`) also made three
  plugin-structure tests fail with `ENOENT … /plugins/sp/skills/.claude/SKILL.md`; removing it
  cleared them, and the scan should skip dot-directories so a harness artifact cannot masquerade
  as a malformed skill (filed in `### Background`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | New L4 rule at `packages/app/src/services/task-check.ts:1145`, code `L4_ROLLUP_ROSTER_NOT_DECLARED_DEPENDENCY` registered at `packages/config/src/finding-codes.ts:123`. A decomposition parent whose Plan carries a sub-task roster warns when frontmatter `dependencies[]` omits an open child, naming the exact missing edges and the repair command. Proven live on the real corpus this run: removing 0698's four edges (`spur task deps 0698 remove 0699 0700 0701 0702`) made `task check 0698` report "Plan rosters open sub-task(s) 0701, 0699, 0700 that frontmatter dependencies[] does not declare … (repair: spur task deps 0698 add …)" — 0702 correctly excluded because it is `done` and so cannot be mis-ordered; restoring the edges returned the check to silent. |
| R2 | MET | `renderReview` prefixes its output with `RECORD_REVIEW_MARKER` (`packages/app/src/services/task-record.ts:454`) and `isRecordAuthoredReview` (`:466`) also recognizes the pre-marker shape via `LEGACY_RECORD_REVIEW_RE`, so the existing corpus self-heals. `record` now rewrites a Review that is bare **or** its own prior output (`packages/app/src/services/task-service.ts:1150`). Proven live: task 0700 carried `**SECU findings** (pipeline verify step — verdict: FAIL)` beside a PARTIAL verdict; re-recording replaced it with `verdict: PARTIAL`. The authored half of the contract holds — 0693, 0701 and 0702 keep their coordinator-written Reviews untouched (`reviewWritten: false` on re-record). |
| R3 | MET | All three triage items have an explicit disposition, recorded in `### Solution`. **(a)** No action, with the reason measured rather than asserted: no repo gate enforces YAML line length (Biome covers 808 files but not YAML; no yamllint config; no rule in `config/rules/`), and all 14 lines over 120 columns in `config/workflows/history-anatomy.yaml` are load-bearing single-line scalars — 4 `input:` prompts and 9 shell `command:` lines where reflow changes the value. **(b)** Fixed: the cwd-dependent assertion in `packages/app/tests/services/anchor-qualifier.test.ts:87` now compares against the git toplevel instead of `process.cwd()`. **(c)** Dispositioned with evidence: the `corpus-check` failure is a new finding code's unbaselined population, not sibling dirt — 88 NEW findings reproduce on a clean `3d57c24f5` tree via `git stash`. The four HEAD-red tests it sat beside are fixed here. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Both directions pinned by `packages/app/tests/services/task-check.test.ts`: a Plan roster with an open child and no `dependencies[]` edge produces exactly one `L4.rollup-roster-not-declared-dependency` warning on section `Plan`, naming the child and carrying `spur task deps 0001 add 0002`; the same fixture with `dependencies: ['0002']` produces none; a `done` child produces none. `cd packages/app && bun test tests/services/task-check.test.ts` → **157 pass / 0 fail**. Reproduced on the live corpus as recorded under R1. |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts` replays record → re-record with a changed verdict and asserts the Review carries `verdict: PASS`, does **not** contain `verdict: FAIL`, and holds exactly one `verdict: ` line (a replacement, not an append). A second test asserts an authored Review survives a re-record untouched (`reviewWritten: false`, coordinator text intact, no `SECU findings` injected). `cd packages/app && bun test tests/services/task-record.test.ts` → **78 pass / 0 fail**. |
| AC3 | MET | command | Each of (a)/(b)/(c) carries an explicit disposition in `### Solution`, and (c) states directly whether task 0700's `corpus-check.ts` / `regen-corpus-baseline.ts` work already covers it: it does not — the residual is `L4.verdict-rows-match-no-scenario`, the finding code 0700 itself introduced, whose existing-corpus population was never baselined. Measured this run by stashing the sweep's changes and re-running against clean `HEAD`: **88** NEW findings there versus **83** with the changes applied. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- Batch tasks: 0698 (parent/findings sweep), 0699, 0700, 0701, 0702 — commits `7d8411002`,
  `a2beb4d51`, `4748fa56`, `4e1a19588`.
- Origin run: 20260828-runall-f95-inline-01 (dogfood artifacts are local-only by gitignore; this
  task is the durable record of its unsolved findings).
- Related docs fix (landed): `plugins/sp/skills/spur-cli/references/tasks/verbs.md`.

### History
- 2026-08-29T05:10:44.842Z todo → wip (system)
- 2026-08-29T05:18:07.262Z wip → testing (system)
- 2026-08-29T05:18:15.486Z testing → done (system)
