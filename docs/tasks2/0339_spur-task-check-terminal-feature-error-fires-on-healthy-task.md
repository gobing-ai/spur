---
template: feature-impl
schema_version: 1
name: "spur task check: terminal-feature error fires on healthy tasks; content-free tasks pass"
description: ""
status: done
type: task
profile: standard
feature_id: F2
parent_wbs: null
priority: P1
tags: ["cli", "gates", "task-check", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.157Z"
updated_at: "2026-07-27T04:37:21.298Z"
---

## 0339. spur task check: terminal-feature error fires on healthy tasks; content-free tasks pass

### Background

Two L3/L4 verdict defects in `packages/app/src/services/task-check.ts`, both surfaced by the 2026-07-26 `/sp:dev-verifyall --feature R2` dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, findings P1 and the follow-up analysis).

**(a) Terminal-feature error fires regardless of the task's own status.** `task-check.ts:477` pushes an `error`-severity `L4_FEATURE_TERMINAL` finding — "Feature X is done — remove or re-parent this task" — whenever the linked feature's status is `done` or `cancelled`, without consulting the task's own status. The normal, healthy terminal state of any completed feature (feature done + all its tasks done) therefore FAILs every one of its tasks, and the remedy the message proposes (unlink the tasks) would destroy exactly the traceability the corpus exists to hold. This is repo-wide and pre-existing, not specific to one feature: verified on task 0320 under done feature Q, and on all seven tasks under R2 the moment R2 reached `done`.

**(b) A content-free task passes the gate.** Task 0337 had `### Background`, `### Requirements`, and `### Acceptance Criteria` bodies consisting solely of template placeholder comments — the AC placeholder literally reads "Do not leave placeholder AC here" — and `spur task check 0337` still returned `0337 (todo): PASS` with zero findings. A task with no requirements is unverifiable by construction, so the gate meant to catch this is blind to it.

### Requirements
R1. Restrict the `L4_FEATURE_TERMINAL` finding at `packages/app/src/services/task-check.ts:477` so it fires only when the task's **own** status is non-terminal. A `done` or `cancelled` task under a `done` or `cancelled` feature is the correct end state and must not produce an error.

R2. Keep the existing signal for the case the rule was written for: a live task (`backlog`/`todo`/`wip`/`testing`/`blocked`) parented to a terminal feature must still be flagged, since that genuinely needs re-parenting.

R3. Add an L3 finding that fails a task whose `### Requirements` or `### Acceptance Criteria` body is empty or consists only of template placeholder comments (HTML comments and whitespace). Reproduce against 0337, which must move from PASS to FAIL.

R4. Do not weaken any existing check to achieve R1 — the fix is a narrower predicate, not a removed rule.

R5. Regression tests in `packages/app/tests/services/task-check.test.ts` covering: terminal task under terminal feature (no error), live task under terminal feature (error retained), placeholder-only Requirements (fail), placeholder-only AC (fail), populated task (pass).

R6. Re-run `spur task check` across the R2 set (0332-0338) and confirm the six non-cancelled tasks return PASS.
### Acceptance Criteria
- **Scenario: terminal task under terminal feature** — Given task 0320 with `status: done` linked to feature Q with `status: done`, when `spur task check 0320` runs, then no `L4_FEATURE_TERMINAL` finding is emitted and the verdict is PASS (modulo other findings).
- **Scenario: live task under terminal feature** — Given task 0001 with `status: todo` linked to feature F1 with `status: done`, when `spur task check 0001` runs, then an `L4_FEATURE_TERMINAL` error finding is emitted with message containing "done".
- **Scenario: cancelled task under cancelled feature** — Given task 0001 with `status: cancelled` linked to feature F1 with `status: cancelled`, when `spur task check 0001` runs, then no `L4_FEATURE_TERMINAL` finding is emitted.
- **Scenario: placeholder-only Requirements fails** — Given task 0337 at `status: todo` whose `### Requirements` body contains only HTML comments and whitespace, when `spur task check 0337` runs, then an `L3_REQUIREMENTS_EMPTY` error finding is emitted and the verdict is FAIL.
- **Scenario: placeholder-only Acceptance Criteria fails** — Given task 0001 at `status: todo` whose `### Acceptance Criteria` body contains only the template placeholder comment ("Do not leave placeholder AC here"), when `spur task check 0001` runs, then an `L3_AC_EMPTY` error finding is emitted.
- **Scenario: populated task passes** — Given task 0001 at `status: todo` with real R-numbered Requirements and real AC scenarios, when `spur task check 0001` runs, then neither `L3_REQUIREMENTS_EMPTY` nor `L3_AC_EMPTY` is emitted.
- **Scenario: missing Requirements section is not double-reported** — Given a task variant/status combination that does not require `### Requirements`, when the section is absent, then no `L3_REQUIREMENTS_EMPTY` finding is emitted (L2 handles missing-required).
### Q&A
- **Q: Should the empty-section check fire when the section is not required by the matrix (e.g. Requirements at `backlog`)?** A: Yes, unconditionally. The bug is that 0337 was unverifiable; matrix-optionality governs section *presence* (L2's job), not *substance*. A content-free Requirements is an unverifiable task regardless of status. Decided in Design.
- **Q: Why error severity and not warning (matches `L3_REQUIREMENTS_FORMAT` which is a warning)?** A: `L3_REQUIREMENTS_FORMAT` is malformed-but-present content (fixable in place); empty/placeholder content is a different defect class — the task is unverifiable by construction. Matches severity of `L3_SOLUTION_FILE_LINE` / `L3_REVIEW_PRIORITY_TABLE` (required-content-missing errors).
- **Q: Does the R1 narrowing affect the cancelled-task case?** A: Yes, symmetrically — `cancelled` task under `cancelled` feature is also a correct end state and no longer errors. Both `done` and `cancelled` are in the `taskTerminal` predicate.
- **Q: Why thread `status` into `runL4` rather than re-reading frontmatter inside?** A: `status` is already computed once at `task-check.ts:256` and passed to `runL3`/`runL4Rollup`/`runL4Readiness`. Threading it into `runL4` matches the established pattern (line 279 already gates readiness on `status !== 'done' && !== 'cancelled'`) and avoids a second frontmatter parse.
### Design
Two independent predicates in `packages/app/src/services/task-check.ts`. No schema or matrix change.

**(a) `L4_FEATURE_TERMINAL` scope (R1/R2).** The finding at `task-check.ts:477-485` fires purely on `featureStatus === 'done' || 'cancelled'`. Add the task's own status to the predicate so a terminal task under a terminal feature is the correct end state:

```
const taskTerminal = status === 'done' || status === 'cancelled';
if ((featureStatus === 'done' || featureStatus === 'cancelled') && !taskTerminal) { … push finding … }
```

`status` is already computed at `task-check.ts:256` and is threaded into `runL3` (line 267); extend `runL4`'s signature (`task-check.ts:430-436`) to accept `status: string` and update the caller at `task-check.ts:271`. The local `closed = (s) => s === 'done' || s === 'cancelled'` helper at line 566 already establishes the pattern; reuse the inline form here for consistency with how L4 readiness gates it at line 279.

Invariant (R4): no existing check is weakened. The finding's message, code, severity, and triggering condition for live tasks are unchanged — only the predicate narrows.

**(b) Content-free section enforcement (R3).** Two new error-severity L3 findings, reusing the existing `isPlaceholderBody` helper (`task-check.ts:59-65`, which strips `<!-- … -->` and `> TBD` markers) and `stripAcFence` for AC:

- `L3_REQUIREMENTS_EMPTY` — fires when `### Requirements` body is null OR `isPlaceholderBody(body)`.
- `L3_AC_EMPTY` — fires when `### Acceptance Criteria` body is null OR `isPlaceholderBody(stripAcFence(body))`.

Placement: inside `runL3` (`task-check.ts:287-426`), as the first checks before the existing R-numbering warning. Why first: a placeholder body must hard-fail before the format rule runs, otherwise `isPlaceholderBody(body) === true` skips the R-numbering block at line 295 and the task still slips through with only a warning. Severity `error` makes them gate-failing per `summarizeWithStatus` (`planning-check-base.ts:222`).

Add two codes to `FINDING_CODES` (`packages/config/src/finding-codes.ts:77+`): `L3_REQUIREMENTS_EMPTY: 'L3.requirements-empty'`, `L3_AC_EMPTY: 'L3.ac-empty'`.

Why both sections and not just Requirements: the bug report (0337) had both placeholder. R3 names them disjunctively ("Requirements or AC"). A task with real Requirements but placeholder AC is equally unverifiable — AC is the contract the verify step checks against.

Why error not warning: a content-free task is unverifiable by construction. The existing `L3_REQUIREMENTS_FORMAT` is a warning because malformed-but-present content is fixable in place; absent content is a different class of defect. Matches the severity of `L3_SOLUTION_FILE_LINE` and `L3_REVIEW_PRIORITY_TABLE` (also errors for "required-content-missing" failures).

**Tradeoff considered:** keying the new check to the matrix `required` list (only fire when Requirements/AC is status-required) vs. firing unconditionally. Chose unconditional: the placeholder AC at `todo` is the exact bug (0337 was at `todo`, where AC IS required anyway), and a content-free Requirements at `backlog` (where the section is optional) is still an unverifiable task the operator should be warned about. The matrix already drives *presence* (L2); L3 here drives *substance*. Firing unconditionally closes the dogfood gap regardless of variant.

**Impacted surfaces:** `task-check.ts` (runL4 signature + predicate, runL3 two new findings), `finding-codes.ts` (two new codes), `task-check.test.ts` (5+ new tests). No CLI, contract, or migration surface — findings surface through the existing `--json` shape.
### Plan
1. Add `L3_REQUIREMENTS_EMPTY` and `L3_AC_EMPTY` to `FINDING_CODES` in `packages/config/src/finding-codes.ts`.
2. Extend `runL4` signature in `packages/app/src/services/task-check.ts` to accept `status: string`; update caller at line 271.
3. Narrow the `L4_FEATURE_TERMINAL` predicate at `task-check.ts:477` to `featureTerminal && !taskTerminal`.
4. Add the two empty-section L3 findings at the top of `runL3` in `task-check.ts`, before the existing R-numbering warning.
5. Add regression tests in `packages/app/tests/services/task-check.test.ts` for all six scenarios (terminal-terminal PASS, live-terminal error retained, placeholder Requirements FAIL, placeholder AC FAIL, populated PASS, missing-section no-double-report).
6. Run `bun test packages/app/tests/services/task-check.test.ts` and confirm green.
7. Run `spur task check` across the R2 set (0332-0338) and confirm the six non-cancelled tasks return PASS.
8. Fill Solution/Testing/Review sections; transition through `done`.
### Solution
Two-predicate fix in `packages/app/src/services/task-check.ts`; two new finding codes in `packages/config/src/finding-codes.ts` (added to both `ALL_FINDING_CODES` and `FINDING_CODES`).

**(a) `L4_FEATURE_TERMINAL` narrowed (R1/R2).** `runL4` (`task-check.ts:431`) now takes `status: string`; caller at `task-check.ts:271` passes the already-computed task status. The predicate at `task-check.ts:478` changed from

```
if (featureStatus === 'done' || featureStatus === 'cancelled') { … }
```

to

```
const featureTerminal = featureStatus === 'done' || featureStatus === 'cancelled';
const taskTerminal = status === 'done' || status === 'cancelled';
if (featureTerminal && !taskTerminal) { … }
```

A done/cancelled task under a done/cancelled feature is now the correct end state and produces no error. Live-task signal (R2) is unchanged: the finding still fires with identical message, code, and `error` severity for any `backlog`/`todo`/`wip`/`testing`/`blocked` task parented to a terminal feature.

**(b) Content-free section enforcement (R3).** Two new error-severity L3 findings, reusing `isPlaceholderBody` (`task-check.ts:59`) and `stripAcFence`:

- `L3_REQUIREMENTS_EMPTY` — fires when `### Requirements` heading exists AND `isPlaceholderBody(body)`.
- `L3_AC_EMPTY` — fires when `### Acceptance Criteria` heading exists AND `isPlaceholderBody(stripAcFence(body))`.

Both fire at the top of `runL3` (`task-check.ts:287`), before the existing R-numbering warning. Severity `error` makes them gate-failing per `summarizeWithStatus` (`planning-check-base.ts:222`).

**Predicate refinement during implementation:** the Design drafted the check as "section body null OR placeholder". That broke the existing `L1: schema validation passes for valid frontmatter` test, which uses a `backlog` task with no Requirements/AC headings (legitimately absent at `backlog` where the matrix does not require them). The final predicate fires only when the section heading **exists** but the body is placeholder-only — a missing section remains L2's job (matrix-driven presence). This matches R3 precisely ("body is empty or consists only of template placeholder comments" — the body exists to be checked) and preserves the L2/L3 separation: L2 drives presence, L3 drives substance.

Codes added at `finding-codes.ts` in both registries:
- `ALL_FINDING_CODES` (line 20): `'L3.requirements-empty'`, `'L3.ac-empty'`.
- `FINDING_CODES` (line 78): `L3_REQUIREMENTS_EMPTY: 'L3.requirements-empty'`, `L3_AC_EMPTY: 'L3.ac-empty'`.

Both must be kept in sync — `FindingCode` is `(typeof ALL_FINDING_CODES)[number]` and `FINDING_CODES` is `as const satisfies Record<string, FindingCode>`, so adding to the named-constant object without the array fails tsc.

**R4 (no weakening):** the existing `L3_REQUIREMENTS_FORMAT` warning and `L4_FEATURE_TERMINAL` error retain their triggers, severities, and messages. The fix is purely a narrower predicate on (a) and two added findings on (b).

**Files touched**
- `packages/config/src/finding-codes.ts` — 2 new codes (both registries).
- `packages/app/src/services/task-check.ts` — `runL4` signature + caller, narrowed terminal-feature predicate, two new findings at top of `runL3`.
- `packages/app/tests/services/task-check.test.ts` — 7 new tests under `describe('TaskCheckService task 0339 (terminal-feature + content-free)')`.

**Harness note:** the `spur` on PATH (`/Users/robin/.bun/bin/spur` → published npm package) is stale and does not contain this fix. Verified R6 via `bun run apps/cli/src/index.ts`. AGENTS.md documents the `bun link` + `build:bundle` workflow for putting the monorepo CLI on PATH during Spur dev; bundle was rebuilt (`apps/cli/spur.js`, 3.21 MB) but PATH still resolves to the npm install. Not a code defect — operator can re-link if needed.
### Testing
Commands run and outcomes:

- `bun test packages/app/tests/services/task-check.test.ts` — **86 pass / 0 fail**, 120 expect() calls. Includes the 7 new tests under `describe('TaskCheckService task 0339 (terminal-feature + content-free)')`:
  - R1: done task under done feature → no `L4_FEATURE_TERMINAL` (PASS).
  - R1: cancelled task under cancelled feature → no `L4_FEATURE_TERMINAL` (PASS).
  - R2: live (todo) task under done feature → `L4_FEATURE_TERMINAL` error retained, message contains "done".
  - R2: live (wip) task under cancelled feature → `L4_FEATURE_TERMINAL` error retained, message contains "cancelled".
  - R3: placeholder-only Requirements → `L3_REQUIREMENTS_EMPTY` error, `pass: false`.
  - R3: placeholder-only AC → `L3_AC_EMPTY` error, `pass: false`.
  - R3: populated Requirements + AC → no empty findings, `pass: true`.
  - R3: AC with only ```` ``` ```` fence around placeholder → `L3_AC_EMPTY` (confirms `stripAcFence` runs before `isPlaceholderBody`).
- `bun test packages/app/tests/services/` — **807 pass / 0 fail** across 31 files. No regressions in adjacent services.
- `bun test packages/config/` — **92 pass / 0 fail**. Finding-code registry changes don't break existing config tests.
- `bun x tsc --noEmit` in `packages/app` and `packages/config` — clean.
- `bun x biome check` on `task-check.ts`, `finding-codes.ts` (both packages), `task-check.test.ts` — clean, no fixes applied.
- R6 (`spur task check` across R2 set via `bun run apps/cli/src/index.ts`):
  - 0332 (done): PASS, 0 findings.
  - 0333 (done): PASS, 0 findings.
  - 0334 (done): PASS, 0 findings.
  - 0335 (done): PASS, 0 findings.
  - 0336 (done): PASS, 0 findings.
  - 0337 (cancelled): **FAIL** — `L3.requirements-empty` + `L3.ac-empty`. This is the original content-free offender from the bug report; failing is the intended behavior change.
  - 0338 (done): PASS — 5 `L4.uncovered-task-scenario` warnings (pre-existing AC-coverage warnings, unrelated to 0339; severity `warning` so pass=True).

Coverage: `packages/app/src/services/task-check.ts` at 98.15% functions / 99.64% lines (unchanged from baseline; the two uncovered lines 110-111 are pre-existing and unrelated to this change). `packages/config/src/finding-codes.ts` at 98.81% lines.
### Review
| P | Finding | File:Line | Fix / Disposition |
| --- | --- | --- | --- |
| P1 | Initial Design drafted empty-section check as "body null OR placeholder", which would have fired on legitimately-absent sections (e.g. Requirements at `backlog` where the matrix doesn't require it) and broken the existing `L1: schema validation passes` test. | `packages/app/src/services/task-check.ts:298-317` | Refined predicate during implementation to "section heading exists AND body is placeholder-only". A missing section remains L2's job (matrix-driven presence); L3 drives substance. Caught by the first test run before any commit. |
| P2 | PATH-installed `spur` (`/Users/robin/.bun/bin/spur` → published npm package) is stale and doesn't contain the fix; R6 initially showed all R2 tasks failing because the old bundle was running. | n/a | Re-ran R6 via `bun run apps/cli/src/index.ts` (monorepo source). Rebuilt `apps/cli/spur.js` per AGENTS.md but PATH still resolves to npm install — operator can `bun link` if they want the monorepo CLI on PATH. Not a code defect. |
| P3 | Two finding-code registries must stay in sync (`ALL_FINDING_CODES` array + `FINDING_CODES` named-constant object); tsc enforces this via `satisfies Record<string, FindingCode>`. | `packages/config/src/finding-codes.ts:9,66` | Added codes to both; tsc caught the initial miss. |

Residual risk: low. The narrowed `L4_FEATURE_TERMINAL` predicate is purely additive (a `done`/`cancelled` task no longer trips it; live tasks still do). The two new L3 findings only fire on placeholder content that already exists in the corpus — the dogfood set confirms 0337 fails as intended while 0332-0336 pass cleanly.

Final disposition: **PASS**. Both bugs fixed, 7 regression tests added, R6 verified, no regressions across 807 service tests + 92 config tests.
### References

F2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-27T04:25:44.589Z todo → wip (system)
- 2026-07-27T04:30:28.761Z wip → testing (system)
- 2026-07-27T04:35:40.338Z testing → done (system)
- 2026-07-27T04:35:55.514Z done → wip (system)
- 2026-07-27T04:37:21.298Z wip → done (system)
