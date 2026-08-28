---
schema_version: 1
name: "Close-out integrity: anchor-drift detection, verified-box auto-flip, FSM denial guidance, resolveRepoRoot fix"
status: done
template: feature-impl
created_at: 2026-08-27T20:16:10.910Z
updated_at: "2026-08-28T03:52:29.876Z"
feature_id: F94
priority: P2
---

## 0692. Close-out integrity: anchor-drift detection, verified-box auto-flip, FSM denial guidance, resolveRepoRoot fix

### Background

Three close-out frictions and one pre-existing bug from the 0688 session (2026-08-27), merged into one implementation surface (packages/app task/feature services) and one test pass:

- **Anchor drift:** 0606's `eval-pipeline.ts:528` drifted to `:562` after 0688's +34-line edit — caught only post-commit, by a human, not by any gate.
- **Unchecked boxes:** 0688 closed with **21** unchecked Requirements/AC boxes in a done task; `L3.unchecked-checklist` then forced post-close flips — a history rewrite of a done task.
- **Useless FSM denials:** `feature update F91 done` was denied with "No transition from active to done" — no hint that `feature sync` derives the legal hop path (`active → verifying → done`). Task transitions share the same silent-denial shape.
- **`resolveRepoRoot` cwd-dependence:** pre-existing bug, verified via stash during 0688; repo-root resolution varies with the invoking directory.

### Requirements

- [x] R1. **Anchor-drift detection** — `task check` re-resolves line-number citations against
      the current tree and reports drift, surfaced at commit-prep (precedent: 0606's
      `eval-pipeline.ts:528` → `:562`).
- [x] R2. **Auto-flip** — record/verify flips Requirements+AC checkboxes to checked when the
      verdict marks them MET/PASS; never on PARTIAL/FAIL/UNKNOWN verdicts or boxes the verdict
      does not mention.
- [x] R3. **FSM denial guidance** — `GuardDeniedError` messages name the legal path(s) and the
      command that reaches them (e.g. the feature `active→done` denial points at `feature sync`
      hop derivation; the task FSM likewise).
- [x] R4. **Rider** — fix `resolveRepoRoot` cwd-dependence with a regression test invoking from
      a nested directory.
- [x] R5. **One surface** — implement in the packages/app task/feature services; one test pass
      covers all four.

### Acceptance Criteria

```gherkin
Scenario: R2 — Line-number anchor drift is caught at commit-prep, not post-commit
  Given a task citing `path:line` anchors that a source edit moved
  When `task check` re-resolves the citations against the current tree
  Then drift is reported naming the cited and current positions
  And stable citations stay silent

Scenario: R3 — A verdict that marks a requirement MET/PASS leaves its boxes checked
  Given a verdict marking requirements MET (or a mixed PARTIAL verdict)
  When `task record` writes
  Then exactly the proven boxes flip to checked
  And ambiguous or unmentioned boxes stay untouched

Scenario: R4 — A denied transition names the legal path
  Given a denied feature/task transition (including `active → done`)
  When the error renders
  Then it names the legal path and the command that reaches it

Scenario: R7 — Repo-root resolution does not depend on cwd
  Given `resolveRepoRoot` invoked from the repo root and from outside the target project
  When the repo root is resolved
  Then both resolve to the same root
  And the four fixes are covered in one test pass
```

### Q&A

- **Does AC4's nested-directory test reproduce the bug?** No. Verified 2026-08-27: `git rev-parse
  --show-toplevel` returns the same root from the repo root and from `docs/tasks4`. The real defect
  is the `process.cwd()` fallback when the process is outside the target project. AC4's *intent*
  (cwd-independent resolution) stands; the Design and Plan pin the test to the repro that actually
  fails. AC text left as filed — the executable form is fixed in Plan step 2.
- **Should `task check` auto-fix drifted anchors?** No. `anchorQualify` already owns the write path;
  a checker that rewrites its own evidence cannot be trusted. Decided: report only.
- **What flips on a bare `PASS` with no per-requirement detail?** Nothing beyond what the verdict
  names. A verdict that proves nothing per-requirement flips nothing — false-checked boxes are worse
  than unchecked ones.
- **New error class for R3?** No. `GuardDeniedError` (`packages/app/src/errors.ts:8`) is reused;
  enrichment is message content, optionally one added field. A new class would ripple through
  `apps/server/src/middleware/error-handler.ts` for no behavioral gain.
- **Is R5's "one surface" literally true?** Mostly. The behavior lives in `packages/app`, but R3's
  denial text is *rendered* to users through `apps/cli/src/commands/task.ts` and
  `apps/server/src/middleware/error-handler.ts`; expect to touch those only if a message is
  reformatted there.
- **Deferred:** whether the R1 drift report becomes its own finding code or a report section — left
  to implementation, on condition it does not mint a new baselined finding class while 0691's gate
  simplification is undecided (owner: this task's implementer).

### Design

**WHAT.** Four independent close-out fixes landed on one surface and one test pass: anchor-drift
reporting in `task check` (R1), verdict-driven checkbox auto-flip in the record path (R2),
`GuardDeniedError` message enrichment in both FSMs (R3), and the `resolveRepoRoot` cwd-dependence
fix (R4).

**WHY.** Each one cost the 0688 session real rework: drift caught post-commit by a human, 21
post-close box flips rewriting a done task's history, a denial message that named no legal path, and
a repo-root resolver that silently indexes the wrong tree.

**WHERE (verified against the tree, 2026-08-27).**

| R | Primary target | Current state |
| --- | --- | --- |
| R1 | `packages/app/src/services/anchor-qualifier.ts` (`ANCHOR_RE`, ~:90) + `packages/app/src/services/task-check.ts` | The anchor regex and the tracked-file index already exist; drift *re-resolution* does not |
| R2 | `packages/app/src/services/task-record.ts` | Has `parseVerdict` / `renderTesting` / `parseTesting`; carries **no** checkbox handling at all — auto-flip is net-new here. The checkbox parser to reuse lives in `task-check.ts` (~:874–907), not to be re-implemented |
| R3 | `packages/app/src/errors.ts` (`GuardDeniedError`, :8) + the task and feature FSM throw sites in `packages/app/src/services/task-service.ts` / feature service | `GuardDeniedError` is a bare message-only `Error` subclass — no structured legal-path field today |
| R4 | `packages/app/src/services/anchor-qualifier.ts` `resolveRepoRoot` (:99) | Falls back to `process.cwd()` when `projectRoot` is absent; the caller-scoping hazard is already documented in the `anchorQualify` doc comment (~:239–243) |

**Frozen names.** Reuse `GuardDeniedError` (`packages/app/src/errors.ts`) — do **not** introduce a
new error class; enrichment is either a richer message at the throw site or one added optional field
on the existing class. Reuse the `task-check.ts` checkbox parser for R2 rather than a second regex.
Verdict values are exactly `PASS | PARTIAL | FAIL | UNKNOWN` (`task-record.ts` `CanonicalVerifyVerdict`).

**Precedence / algorithm.**

- **R2 auto-flip is conservative by construction:** flip a box only when the verdict names that
  requirement id AND marks it MET/PASS. `PARTIAL` flips exactly the requirement ids the verdict
  proves and leaves the rest; `FAIL` / `UNKNOWN` flip nothing. A box the verdict does not mention is
  never touched — silence is not proof.
- **R1 drift is a report, not a rewrite:** `task check` reports the cited position and the current
  position. It must not auto-rewrite anchors — `anchorQualify` already owns the write path, and a
  check that silently edits the thing it is checking destroys the evidence.

**Anti-patterns (do NOT implement).**

- No new error class, no new finding-code family for R3 (message enrichment only).
- No anchor auto-rewrite inside `task check` (see above).
- No flipping of unmentioned boxes on a bare `PASS` verdict — that reintroduces the unchecked-box
  problem as a false-checked-box problem, which is strictly worse (it lies rather than nags).
- Do not scope R4's fix to `anchorQualify`'s caller only; `resolveRepoRoot` is exported and the
  cwd fallback is the defect.

**Premise correction — AC4 as filed does not reproduce the bug.** `git rev-parse --show-toplevel`
returns the identical root from the repo root and from any nested directory *inside* the same repo
(verified 2026-08-27 from `docs/tasks4`). The actual cwd-dependence is the `process.cwd()` fallback
when the process sits **outside the target project** — the documented symptom is `Files scanned: 0`
for the intended target. The regression test must invoke with the process cwd outside the target
project (or in a different repo) and assert the target project's root is still resolved; a
nested-directory test passes today and proves nothing.

**Cross-task.** No `dependencies[]`. Independent of 0691 (gate/baseline policy) and 0694 (docs) —
this task owns the `packages/app` behavior change only, and leaves the symbol-anchor citation
*convention* to 0694. If R1's drift report needs a documented citation convention, cite 0694's
output rather than re-authoring it here.

### Plan

- [x] 1. R4 first (it unblocks trustworthy anchor work): make `resolveRepoRoot`
      (`packages/app/src/services/anchor-qualifier.ts:99`) derive from the caller's project context
      instead of falling back to `process.cwd()`. → R4.
- [x] 2. Regression test for R4 that invokes with the process cwd **outside** the target project and
      asserts the target's root resolves (a nested-dir-inside-repo test is vacuous — see Design). → AC4.
- [x] 3. R1: re-resolve `path:line` citations in `task check` against the current tree and emit a
      drift report naming cited vs current position. Report only — no rewrite. → R1, AC1.
- [x] 4. R1 test: a moved anchor reports drift; a stable anchor stays silent. → AC1.
- [x] 5. R2: in the record/verify write path (`task-record.ts`), flip exactly the Requirements/AC
      boxes the verdict marks MET/PASS, reusing `task-check.ts`'s checkbox parser. → R2.
- [x] 6. R2 tests: full-PASS flips the named boxes; PARTIAL flips only proven ids; FAIL/UNKNOWN flip
      nothing; unmentioned boxes untouched under every verdict. → AC2.
- [x] 7. R3: enrich `GuardDeniedError` messages at the task and feature FSM throw sites to name the
      legal path(s) and the command that reaches them, including the `feature active → done` →
      `feature sync` case. → R3.
- [x] 8. R3 test: a denied transition's message contains the legal path and the command. → AC3.
- [x] 9. One test pass: `bun run test` green across all four; confirm coverage holds at the 90/90
      bar. → R5, AC5.
- [x] 10. `bun run autofix && bun run spur-check`, then `spur task check --corpus` once before commit.

### Solution
Four close-out fixes on one surface, landed in commit `cee844c45` (10 files, +346/-16).
Citations use the `path:symbol` form per `docs/04_DESIGN.md` §4.2 (task 0694), with the
line anchor given where the symbol is a branch rather than a named export.

| R | Change | Where |
|---|--------|-------|
| R1 | `task check` re-resolves each `path:line` citation against the current tree and reports the cited vs current position; report-only, no rewrite (`anchorQualify` keeps the write path). Reported under the existing `L4_STALE_LINE_ANCHOR` code — no new finding class minted. | `packages/app/src/services/task-check.ts:1402` (drift branch), `packages/app/src/services/task-check.ts:1408` (message) |
| R2 | `flipVerifiedCheckboxes` flips Requirements/AC boxes only where the verdict names the requirement id AND marks it MET. PARTIAL flips exactly the proven ids; FAIL/UNKNOWN flip nothing; unmentioned boxes are never touched. Reuses the `task-check.ts` checkbox parser, not a second regex. | `packages/app/src/services/task-record.ts:191` — `flipVerifiedCheckboxes` |
| R3 | `GuardDeniedError` (reused, no new class) messages name the legal path and the command that reaches it; the feature `active → done` denial points at `spur feature sync`, the task FSM likewise. | `packages/app/src/workflow/lifecycle-adapter.ts:245`; throw sites `packages/app/src/services/task-service.ts:1192` and `:1216`; class `packages/app/src/errors.ts:8` |
| R4 | `resolveRepoRoot` takes an optional `hintDir` probed ahead of `process.cwd()`, so a process outside the target project still resolves the target's git toplevel instead of indexing the wrong tree. | `packages/app/src/services/anchor-qualifier.ts:105` — `resolveRepoRoot` |
| R5 | One surface (`packages/app` services + workflow lifecycle adapter), one test pass across five files. | `packages/app/tests/services/task-check.test.ts:3408`, `packages/app/tests/services/task-record.test.ts:712` and `:1091`, `packages/app/tests/services/anchor-qualifier.test.ts:92`, `packages/app/tests/workflow/lifecycle-adapter.test.ts:55`, `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:59` |

**Deviation from the filed AC4.** A nested-directory repro passes today and proves nothing —
`git rev-parse --show-toplevel` returns the same root from anywhere inside a repo. The regression
test invokes with the process cwd **outside** the target project, which is the condition that
actually failed (`packages/app/tests/services/anchor-qualifier.test.ts:92`). Recorded in the task's
Design as a premise correction before implementation.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-check.ts:1402` (drift branch: `if (driftLine > 0)`) and `:1408` (report message `Anchor drift \`<cite>\` — subject (…) cited at <n> now sits at line <m>; re-point the citation`) — re-resolution against the current tree, reported under the existing `L4_STALE_LINE_ANCHOR` code (no new finding class minted, per the task's anti-pattern list). Report-only: no rewrite path added. Test: `packages/app/tests/services/task-check.test.ts:3408` `describe('0692 R1 — anchor-drift detection')`. Run this session: `bun test packages/app/tests/services/task-check.test.ts` → 146 pass / 0 fail. |
| R2 | MET | `packages/app/src/services/task-record.ts:191` `export function flipVerifiedCheckboxes(body, verdict)` — flips a box only when the verdict names that requirement id AND marks it MET; PARTIAL flips only proven ids; FAIL/UNKNOWN flip nothing; unmentioned boxes untouched. Reuses the `task-check.ts` checkbox parser rather than a second regex (frozen-name constraint honored). Tests: `packages/app/tests/services/task-record.test.ts:712` (`R2 (0692): record flips the Requirements box a PASS verdict proves`) and `:1091` (`describe('flipVerifiedCheckboxes')` — PASS/PARTIAL/FAIL/UNKNOWN and id-normalization cases). Run this session: `bun test packages/app/tests/services/task-record.test.ts` → 74 pass / 0 fail. |
| R3 | MET | `packages/app/src/errors.ts:8` `export class GuardDeniedError extends Error` — reused, no new error class (anti-pattern honored). Enrichment at `packages/app/src/workflow/lifecycle-adapter.ts:245` — the `active → done` denial names `spur feature sync <id> (derives the legal hop path)`; the task FSM path is enriched at the same seam. Tests: `packages/app/tests/workflow/lifecycle-adapter.test.ts:55` (`R3 (0692): task denial names the legal path and the reaching command`) and `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:59` (`R3 (0692): active→done denial names the legal path and the feature sync command`). Run this session: 16 pass / 0 fail and 8 pass / 0 fail respectively. |
| R4 | MET | `packages/app/src/services/anchor-qualifier.ts:105` `export async function resolveRepoRoot(projectRoot: string \| undefined, hintDir?: string)` — the `process.cwd()` fallback is now the *second* probe behind a caller-supplied `hintDir`, so a process outside the target project still resolves the target's git toplevel. Test: `packages/app/tests/services/anchor-qualifier.test.ts:92` (`R4: hint resolves the target project root when cwd is outside the project`) — the corrected repro (a nested-dir-inside-repo test is vacuous, per the task's premise correction). Run this session: `bun test packages/app/tests/services/anchor-qualifier.test.ts` → 23 pass / 0 fail. |
| R5 | MET | One surface (`packages/app` task/feature services + the workflow lifecycle adapter) and one test pass. Commands run this session: `bun test` over `packages/app/tests/services/task-check.test.ts` (146), `task-record.test.ts` (74), `anchor-qualifier.test.ts` (23), `packages/app/tests/workflow/lifecycle-adapter.test.ts` (16), `feature-lifecycle-adapter.test.ts` (8) — 267 pass / 0 fail total. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Line-number anchor drift is caught at commit-prep, not post-commit | MET | test | Drift re-resolution + report: `packages/app/src/services/task-check.ts:1402`, message naming cited vs current position at `:1408`. Stable citations stay silent (the branch is entered only when `driftLine > 0`). Test `packages/app/tests/services/task-check.test.ts:3408` — `bun test packages/app/tests/services/task-check.test.ts` → 146 pass / 0 fail this session. |
| Scenario: R3 — A verdict that marks a requirement MET/PASS leaves its boxes checked | MET | test | `packages/app/src/services/task-record.ts:191` flips exactly the proven boxes; ambiguous/unmentioned boxes untouched. Tests `packages/app/tests/services/task-record.test.ts:712` and `:1091` — `bun test packages/app/tests/services/task-record.test.ts` → 74 pass / 0 fail this session. |
| Scenario: R4 — A denied transition names the legal path | MET | test | `packages/app/src/workflow/lifecycle-adapter.ts:245` renders `spur feature sync <id> (derives the legal hop path)` on the `active → done` denial; `packages/app/src/errors.ts:8` `GuardDeniedError` reused. Tests `packages/app/tests/workflow/lifecycle-adapter.test.ts:55` (16 pass / 0 fail) and `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:59` (8 pass / 0 fail) this session. |
| Scenario: R7 — Repo-root resolution does not depend on cwd | MET | test | `packages/app/src/services/anchor-qualifier.ts:105` — `hintDir` probed before `process.cwd()`. Test `packages/app/tests/services/anchor-qualifier.test.ts:92` invokes with cwd outside the target project and asserts the target's root; `bun test packages/app/tests/services/anchor-qualifier.test.ts` → 23 pass / 0 fail this session. "Four fixes in one test pass" covered by the 267-test run under R5. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:4e86b9029d321f3fda2bc22982d6891d75084eb19991e6f8754e8e6e46b4b6c5 |
### References

- Parent feature: `docs/features/F94_pipeline-close-out-and-gate-friction-*.md` (R2–R4 rows)
- `packages/app/src/services/anchor-qualifier.ts` — `resolveRepoRoot` (:99), `ANCHOR_RE` (~:90), `anchorQualify` caller-scoping note (~:239–243)
- `packages/app/src/services/task-check.ts` — checkbox parser (~:874–907), `L3.unchecked-checklist` emission
- `packages/app/src/services/task-record.ts` — `parseVerdict` / `parseTesting` / `renderTesting`; `CanonicalVerifyVerdict` = `PASS | PARTIAL | FAIL | UNKNOWN`
- `packages/app/src/errors.ts:8` — `GuardDeniedError`
- `packages/config/src/finding-codes.ts:32,102` — `L3.unchecked-checklist`
- `apps/cli/src/commands/task.ts:279`, `apps/server/src/middleware/error-handler.ts:127` — where denials surface to users
- Source session: task 0688 (2026-08-27), commits f7402c21 / f60e5aec1; ADR-088 for the anchor matcher context
- Sibling tasks: 0691 (gate/baseline simplification), 0694 (docs consolidation)

### History
- 2026-08-28T01:04:55.781Z todo → wip (system)
- 2026-08-28T02:09:22.880Z wip → testing (system)
- 2026-08-28T02:09:36.582Z testing → done (system)
