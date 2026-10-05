---
schema_version: 1
name: Residuals from 1085
status: backlog
template: standard
created_at: 2026-10-05T02:00:47.839Z
updated_at: "2026-10-05T02:55:55.003Z"

feature_id: O
---

## 1087. Residuals from 1085

### Background

Source task: 1085 (feature E72) — deferred residuals filed by residual-scan settle.

- review-finding:857e62b5 — packages/app/src/workflow/progress-projection.ts:494, :588-605: R4 / AC1 "no recorded row is silently dropped" is not met for same-kind rows beyond the first match inside one visit: a visited state's whole candidate set is marked claimed while only `candidateRows[0]` becomes an attempt, so extra `node`+`kind` rows (retries) are consumed with neither attempt nor diagnostic. The task's Solution records this as deferred, but R4's text, AC1's "hides no recorded action" and E72 R10's "no recorded action row is dropped without a diagnostic naming it" still assert it. Live this review, 5 of 34 `action_runs` rows on `inline-1085-8b6cdda2` appear in no attempt and in no diagnostic message: `8d41846d…`/`d8735648…`/`494296bb…` (`test`/`proof.fingerprint`), `c68a6b71…` (`test-recheck`/`shell`), `5861da85…` (`triage`/`decide`). Disposition required: accept explicitly by narrowing R4/AC1 (+ E72 R10) to the delivered two-cause split and filing the retry-row follow-up, or fix — a fix also adds diagnostics to transition-present runs and must reword R5 with it.
- review-finding:024d984d — packages/app/src/workflow/progress-projection.ts:496, packages/app/tests/workflow/progress-projection.test.ts:653, docs/design/workflow-observability.md:279, docs/design/run-record-contract.md:64: Engine-run diagnostics are not byte-identical, contradicting R5's clause and two same-commit doc sentences: the `isVisited` consumption gate applies to transition-present runs too, so a row whose `node` is a declared state the run never visited now yields `unvisited-state-row` where the old code consumed it silently. The commit's own R4 test seeds a transition (`precheck → done`), i.e. an engine-branch fixture, and asserts exactly that new diagnostic — the deviation is proven by the shipped tests, disclosed in the task's Solution scope note, and absent from the design docs.


Re-homed from the transient 1086 in this worktree: WBS 1086 was allocated independently by a concurrent session (`1086_include-desktop-packaging-in-the-root-build.md` in the invoking tree), so this residual task takes the next free WBS to avoid a duplicate id in the merged corpus.


**Resolution note (2026-10-04 session triage):** the documentation-wording half of the second finding is
fixed inline — `docs/design/workflow-observability.md` and `docs/design/run-record-contract.md` no
longer claim byte-identical engine diagnostics and now state that the `unvisited-state-row` split
applies to transition-present runs too (both files re-checked with biome; E72's receipt re-run after
the change). What remains here is the retry-row visibility gap; the engine-diagnostic behaviour itself
is accepted as the documented split.

### Requirements

- [ ] R1. A visited state's same-kind rows beyond the first match are surfaced as attempts, or named by a diagnostic that identifies the row.
- [ ] R2. No assertion about engine-run behaviour changes (accepted, documented split).
- [ ] R3. A regression test covers the retry-row case.

### Acceptance Criteria

```gherkin
Feature: Observability run-detail refinements

  @core
  Scenario: R1 — Every recorded action row is visible or diagnosed
    # covers: I1
    Given a run whose state was visited and whose action rows include repeats of the same kind
    When its progress is projected
    Then each recorded row appears as an attempt or is named by a diagnostic
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: extend the per-visit row consumption so extra same-kind rows become attempts (keeping the first as the action's primary attempt) or emit a named diagnostic (`repeated-action-row`) naming the row id and location; decide during implementation and record it here.
- Rejected: changing engine-run consumption (the accepted split keeps that path stable).
- Invariants: visits, statuses and the `slowest` emphasis unchanged; no schema change beyond an additive diagnostic code.
- Anchors: `packages/app/src/workflow/progress-projection.ts:494, :588-605`.

### Plan

- [ ] 1. Test first: a fixture with two same-kind rows inside one visit asserting both are surfaced (attempt or diagnostic).
- [ ] 2. Implement the consumption/naming change in `progress-projection.ts`.
- [ ] 3. Gates: `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)`, `bun run typecheck`, `bun run spur-check`.
- [ ] 4. Docs: the diagnostic list in `docs/design/workflow-observability.md` + `docs/design/run-record-contract.md`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
