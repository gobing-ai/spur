---
schema_version: 1
name: "Post-F95 corpus drift reconciliation: re-point shifted anchors, fix matcher false positives, baseline verdict-rows findings"
status: todo
template: issue
created_at: 2026-08-29T06:16:26.174Z
updated_at: "2026-08-29T06:49:11.363Z"
feature_id: F91
ac_altitude: task-local
---

## 0714. Post-F95 corpus drift reconciliation: re-point shifted anchors, fix matcher false positives, baseline verdict-rows findings

### Background
Task 0714 was filed after release `acc12ff95` from the F95 close-out session review. Its original
premise mixed four different populations and prescribed repair before checking whether the records
still had a consumer.

A source-local `task check --corpus --json` at the released tree plus the newly filed task reports
112 new warnings: 33 `L4.dogfood-missing`, 29 `L4.verdict-rows-match-no-scenario`, 15
`L4.stale-line-anchor`, 3 `L4.anchor-subject-mismatch`, 28 legitimate A6 in-flight warnings, and 4
`L4.uncovered-task-scenario` warnings created by 0714 itself. The filed “109 NEW” total and its
34-dogfood breakdown do not reproduce; counts are evidence snapshots, not frozen requirements.

The listed anchor findings are all on completed task records. ADR-092 scopes the corpus sweep to
current work because archived completed records are history with no repair consumer. Re-pointing a
completed task’s evidence to today’s implementation would rewrite the historical proof and is
therefore the wrong fix. The useful contract is narrower: path existence and line bounds remain
checkable facts; heuristic subject matching is useful only on a live task, on a row that provides an
unambiguous subject for exactly one anchor.

Two findings remain actionable without rolling back F95:

- Task 0700 intentionally added `L4.verdict-rows-match-no-scenario` at the feature completion gate.
  Its 29 legacy findings are a missing T10 snapshot wave, not grounds to remove the rule or rewrite
  old verdict tables.
- Task 0713 also found that `extractRequirements` can continue through `### SECUA Review` and parse
  a SECUA row as a requirement whenever the inherited status-column index lands on a Finding cell
  containing `MET`, `PARTIAL`, or `UNMET`. Task 0590 added this section boundary only to
  `extractAcceptanceCriteria`; the sibling requirements scanner remains open.

This refinement replaces the historical re-point campaign with the smallest precision fix, keeps
the F95 verdict-row gate, adds the omitted parser regression, and reconciles only the reviewed
post-release snapshot population.
### Requirements
- [ ] R1. Right-size `checkLineAnchors` without weakening its factual checks: every citation still checks repository-relative path existence and line bounds; terminal (`done`/`cancelled`) records stop running subject/drift heuristics; live records run subject matching only when the citing row contains exactly one line anchor and yields real subject tokens. Delete the filename-derived fallback and whole-file “first matching token is the new line” scan; both manufacture locations from weak tokens rather than verify evidence.
- [ ] R2. Preserve `L4.verdict-rows-match-no-scenario` and reconcile its 29 released-tree legacy findings through the ADR-090/T10 generated-snapshot path. Review the complete candidate diff first: it may accept only the already-dispositioned dogfood flip, A6 in-flight state, verdict-row legacy population, and any residual reviewed findings; no manual baseline edits and no unexplained code class.
- [ ] R3. Close `extractRequirements` at the first markdown heading after its table opens, mirroring `extractAcceptanceCriteria`, so a following SECUA table cannot add requirement rows or change the aggregate verdict. Keep the existing header-name variants, escaped-pipe handling, and malformed-row behavior unchanged.
- [ ] R4. Set task 0714’s AC altitude to `task-local`, update the task-check surface documentation for R1, and leave the F95/F91 shipped contracts intact: no new finding code, CLI noun, verb, flag, or severity change.
- [ ] R5. Targeted regressions pass and `bun run corpus-check` exits 0 with zero new findings after the reviewed snapshot regeneration.

**Out of scope.** Re-pointing citations in completed tasks; rewriting historical Testing/Solution
evidence; removing path-existence or line-bounds checks; removing or demoting
`L4.verdict-rows-match-no-scenario`; reintroducing `ANCHOR_WINDOW_LINES`; changing feature/task AC
matching; fixing A6 work inside this task.
### Acceptance Criteria
```gherkin
Feature: Post-F95 corpus signal reconciliation

  Scenario: R1 — Historical evidence keeps factual checks without heuristic churn
    Given a done task whose cited file exists and whose cited line is in bounds
    When spur task check runs after later code moves the cited subject
    Then no subject-mismatch or inferred drift-location warning is emitted
    And a missing file or out-of-bounds line still emits L4.stale-line-anchor

  Scenario: R2 — Live evidence matching requires an unambiguous subject
    Given a live task with a single-anchor evidence row whose subject is absent from the cited range
    When spur task check runs
    Then L4.anchor-subject-mismatch is emitted
    But a bare-anchor row or a row with multiple anchors is not assigned a guessed subject or line

  Scenario: R3 — The F95 verdict-row gate survives snapshot reconciliation
    Given the 29 released-tree L4.verdict-rows-match-no-scenario findings
    When the reviewed corpus snapshot is regenerated
    Then those legacy feature/task keys are recorded by the generated baseline
    And a new mismatch on an unrecorded feature/task key still fails corpus-check

  Scenario: R4 — SECUA rows never become requirements
    Given a requirement table followed by a SECUA Review table
    And a SECUA Finding cell containing MET, PARTIAL, or UNMET
    When deriveVerdict parses the answer
    Then only rows from the requirement table appear in requirements
    And the SECUA prose cannot lower the aggregate verdict

  Scenario: R5 — The reconciled corpus gate is clean
    Given R1 through R4 are implemented
    When bun run corpus-check runs
    Then it exits 0 with zero new findings
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-29T06:48:28.115Z

| Filed item | Verdict | Disposition |
| --- | --- | --- |
| Re-point 15 shifted anchors | Invalid action | Drop. The records are completed historical evidence; keep path/bounds checks and stop applying heuristic subject drift to terminal records. |
| Baseline 29 verdict-row findings | Valid | Keep the 0700/F95 rule; accept the released legacy population through the generated ADR-090 snapshot after reviewing the complete candidate diff. |
| Markdown-authority false positives | Valid symptom, wrong proposed fix | Do not add authority-path exceptions. Delete filename-derived subjects and the whole-file first-token locator; neither proves a citation moved. |
| Multi-file row false positives | Valid symptom, partially misdiagnosed | Task 0688 already excludes sibling anchors from tokens. The remaining defect is one row-level token set being applied to multiple anchors; skip subject matching when the association is ambiguous. |
| Generated `.spur/run/*` citation | Invalid corpus evidence | Do not re-point or exempt a gitignored artifact ad hoc; terminal-task heuristic suppression removes the false churn while path/bounds behavior remains explicit. |
| SECUA rows parsed as requirements | Valid and omitted from 0714 | Add the same heading boundary already used by `extractAcceptanceCriteria`; this is the smallest root fix. |
| 0714’s own F91 scenario warnings | Self-inflicted | Declare `ac_altitude: task-local`; this task’s implementation criteria are finer than F91’s ship contract. |
### Design
#### WHAT

Two code fixes and one generated-data reconciliation:

1. Narrow anchor content matching to live, single-anchor, subject-bearing evidence rows while
   preserving file existence and line bounds for every status.
2. Close the requirements verdict-table scanner at markdown headings.
3. Regenerate the corpus snapshot only after reviewing the remaining post-release population.

#### WHY

The released findings combine useful gates with heuristic and historical noise. Rewriting completed
records would destroy provenance; removing the F95 verdict-row rule would rollback a shipped
completion gate. The smallest correct change deletes only inference that cannot prove its claim and
adds the parser boundary the prior fix missed.

#### WHERE

| R | Primary target | Change |
| --- | --- | --- |
| R1 | `packages/app/src/services/task-check.ts` — `runL4`, `checkLineAnchors`, `extractPathSubjectTokens` | Pass effective task status into the anchor checker; always perform existence/bounds; return before content matching for terminal status; require exactly one row anchor and non-empty `extractSubjectTokens`; delete `extractPathSubjectTokens` and the whole-file `driftLine` scan; failed exact-range matching remains `L4.anchor-subject-mismatch`. |
| R1 | `packages/app/tests/services/task-check.test.ts` | Replace filename-fallback/drift-location expectations with terminal/live precision fixtures and retain missing-path/out-of-bounds controls. |
| R3 | `packages/app/src/services/task-verdict.ts` — `extractRequirements` | Before the non-table-line `continue`, close `inTable` and clear `colMap` when a markdown heading is encountered. No new helper. |
| R3 | `packages/app/tests/services/task-verdict.test.ts` | Requirement table followed by SECUA rows whose Finding cells contain each status word; assert requirement count/ids and aggregate verdict. |
| R1/R4 | `docs/04_DESIGN.md` task-check contract | State that terminal records receive anchor existence/bounds validation only and live subject matching requires one unambiguous subject-bearing anchor row. |
| R2 | `config/corpus-baseline.json` | Generated only by `bun run scripts/commands/regen-corpus-baseline.ts`; review the diff by `kind:id:code` before accepting it. |

#### FROZEN CONTRACTS

- No new API, finding code, severity override, or CLI surface.
- Keep `L4.stale-line-anchor` for missing/out-of-bounds citations.
- Keep `L4.anchor-subject-mismatch` for an exact-range mismatch on a live, single-anchor,
  subject-bearing row.
- Keep `L4.verdict-rows-match-no-scenario` unchanged.
- Reuse `extractSubjectTokens`, `splitTableCells`, and the existing heading regex
  `/^#{1,6}\s/`; do not add a parser abstraction.

#### PRECEDENCE / ALGORITHM

For each Testing/Solution citation: resolve path → check bounds → if terminal, stop for that
citation → resolve its citing row → if the row has not exactly one parsed line anchor, stop → derive
row subject tokens → if empty, stop → compare only the cited range → emit subject mismatch on
failure. Never search the rest of the file for a guessed replacement line.

For requirements verdict parsing: once the requirement table is open, a markdown heading closes it
before any `startsWith('|')` guard can skip the heading. A later valid requirement header may reopen
the scanner exactly as today.

#### ANTI-PATTERNS

- Do not re-point or rewrite completed task evidence.
- Do not exempt all Markdown citations from existence/bounds validation.
- Do not restore the ±20-line window deleted by ADR-090.
- Do not special-case `docs/00_ADR.md`, SECUA priorities, or literal table names.
- Do not delete/demote the F95 verdict-row finding or rewrite legacy verdict tables.
- Do not hand-edit the generated corpus baseline.

#### HANDOFF

No dependencies or dependents. F91 owns the anchor matcher; task 0714 is task-local AC because its
parser and snapshot criteria do not graduate F91’s feature scenarios.
### Plan
1. [x] Set `ac_altitude=task-local` through `spur task update 0714 --ac-altitude task-local`; strict task check confirms no self-generated AC coverage warnings.
2. [ ] R1: simplify `checkLineAnchors` at the shared seam; delete filename-derived subjects and whole-file drift-location inference while retaining path/bounds and the live exact-range control.
3. [ ] R1: update focused task-check tests for terminal history, ambiguous multi-anchor/bare rows, live single-anchor mismatch, missing path, and out-of-bounds line.
4. [ ] R3: add the heading boundary to `extractRequirements` and the SECUA status-word regression fixture.
5. [ ] R4: update `docs/04_DESIGN.md` to match the narrowed task-check behavior.
6. [ ] Run focused workspace tests from `packages/app`, then `bun run spur-check`.
7. [ ] Run source-local `task check --corpus --json`, classify every remaining new key against the reviewed groups in Background/Q&A, and stop on any unexplained code or entity.
8. [ ] R2: regenerate `config/corpus-baseline.json` with the repository script, review its diff, rerun `bun run corpus-check`, and require zero new findings.
### Root Cause
The task was generated from a post-release corpus sweep without applying the decisions that define
the sweep’s useful scope.

1. ADR-092 limits the sweep to current work because completed archived records have no repair
   consumer. The proposed anchor campaign treated completed evidence as living documentation and
   would have rewritten it after unrelated F95 edits.
2. `checkLineAnchors` combines factual validation with three heuristics: row token extraction,
   filename-derived fallback for tokenless Solution rows, and a whole-file first-token scan that
   reports the first hit as the subject’s new line. Generic tokens such as `adr`, `task`, or `r3`
   make the last two steps non-discriminating; multi-anchor rows provide no anchor↔subject
   association.
3. Task 0700 added `L4.verdict-rows-match-no-scenario` correctly but its existing-corpus population
   never entered the generated snapshot in the same change, violating the retained T10 obligation.
4. `extractRequirements` has no markdown-heading boundary. Task 0590 added that boundary only to
   `extractAcceptanceCriteria`, so requirement parsing remains open into later tables.

Verified surfaces: ADR-090/ADR-092 in `docs/00_ADR.md`; T10/T11 in
`docs/99_PROJECT_CONSTITUTION.md`; `checkLineAnchors` and `extractPathSubjectTokens` in
`packages/app/src/services/task-check.ts`; `extractRequirements` and
`extractAcceptanceCriteria` in `packages/app/src/services/task-verdict.ts`; task 0713’s reproduced
findings and task 0700’s shipped verdict-row rule.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Release baseline: `acc12ff95` (`@gobing-ai/spur-v0.3.66`).
- Task 0713 — F95 close-out findings and the two reproduced matcher/parser false positives.
- Task 0700 — shipped `L4.verdict-rows-match-no-scenario` completion-gate rule.
- Task 0688 / ADR-088 — anchor matcher precision history; sibling-anchor exclusion already landed.
- Task 0691 / ADR-090 — approved single-sided generated snapshot; `ANCHOR_WINDOW_LINES` deletion.
- ADR-092 — active-work corpus scope; archived completed tasks are read-only history.
- Task 0590 — AC-table heading boundary and shared escaped-pipe parser; requirements-table boundary was not included.
- `docs/99_PROJECT_CONSTITUTION.md` T10/T11 — same-change fallout reconciliation and sweep-once discipline.
### History
