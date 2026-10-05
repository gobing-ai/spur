---
schema_version: 1
name: Residuals from 1085
status: backlog
template: standard
created_at: 2026-10-05T02:00:47.839Z
updated_at: "2026-10-05T02:00:57.216Z"

feature_id: O
---

## 1087. Residuals from 1085

### Background

Source task: 1085 (feature E72) — deferred residuals filed by residual-scan settle.

- review-finding:857e62b5 — packages/app/src/workflow/progress-projection.ts:494, :588-605: R4 / AC1 "no recorded row is silently dropped" is not met for same-kind rows beyond the first match inside one visit: a visited state's whole candidate set is marked claimed while only `candidateRows[0]` becomes an attempt, so extra `node`+`kind` rows (retries) are consumed with neither attempt nor diagnostic. The task's Solution records this as deferred, but R4's text, AC1's "hides no recorded action" and E72 R10's "no recorded action row is dropped without a diagnostic naming it" still assert it. Live this review, 5 of 34 `action_runs` rows on `inline-1085-8b6cdda2` appear in no attempt and in no diagnostic message: `8d41846d…`/`d8735648…`/`494296bb…` (`test`/`proof.fingerprint`), `c68a6b71…` (`test-recheck`/`shell`), `5861da85…` (`triage`/`decide`). Disposition required: accept explicitly by narrowing R4/AC1 (+ E72 R10) to the delivered two-cause split and filing the retry-row follow-up, or fix — a fix also adds diagnostics to transition-present runs and must reword R5 with it.
- review-finding:024d984d — packages/app/src/workflow/progress-projection.ts:496, packages/app/tests/workflow/progress-projection.test.ts:653, docs/design/workflow-observability.md:279, docs/design/run-record-contract.md:64: Engine-run diagnostics are not byte-identical, contradicting R5's clause and two same-commit doc sentences: the `isVisited` consumption gate applies to transition-present runs too, so a row whose `node` is a declared state the run never visited now yields `unvisited-state-row` where the old code consumed it silently. The commit's own R4 test seeds a transition (`precheck → done`), i.e. an engine-branch fixture, and asserts exactly that new diagnostic — the deviation is proven by the shipped tests, disclosed in the task's Solution scope note, and absent from the design docs.


Re-homed from the transient 1086 in this worktree: WBS 1086 was allocated independently by a concurrent session (`1086_include-desktop-packaging-in-the-root-build.md` in the invoking tree), so this residual task takes the next free WBS to avoid a duplicate id in the merged corpus.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
