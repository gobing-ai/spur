---
template: issue
schema_version: 1
name: "Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:14.986Z"
updated_at: "2026-08-14T18:15:34.561Z"
---

## 0561. Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate

### Background
During the E6 batch (2026-08-14), task 0558's verify answer embedded the full Gherkin body in the AC row id — `Scenario: R4 — ... (Given ... / When ... / Then ... / And ...)` — and `spur task verdict --from-answer` preserved that id verbatim in the verdict artifact. The feature scenario gate matches AC rows by exact normalized scenario title (feature-check.ts `isScenarioVerified`), so R4 was flagged `L4.scenario-unverified` despite a PASS verdict with a MET row. This required post-hoc surgery: hand-editing the answer file and re-deriving the verdict before the E6 feature could transition to done. Evidence: `.spur/run/0558-verify-answer.txt` (row 15), `.spur/run/0558-verdict.json` (AC id), feature-check finding at 17:23.
### Requirements
- [ ] R1. Verdict AC-row ids cannot fail the scenario gate — normalize or validate AC row ids in the verdict derivation path so a trailing Gherkin body (parenthetical steps) cannot break exact-title matching; a malformed id is either matched after normalization or rejected at parse time with a clear message naming the row.
### Acceptance Criteria
```gherkin
Scenario: an AC row id with an embedded Gherkin body still verifies its scenario
  Given a verify answer whose AC row id appends Gherkin steps in parentheses
  When the verdict is derived and the feature scenario gate runs
  Then the scenario is matched after normalization and reported verified
  And no answer-file surgery is required
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Fix target (two-layer): (1) `packages/app` verdict parser — normalize AC row ids when building the verdict artifact (strip a trailing `(...)` parenthetical, or match against the normalized scenario title set); (2) `sp-dev-verify` answer-file schema guidance — the answer contract should state the row id must be exactly the scenario title. Primary fix is the parser normalization (defense in depth); guidance is secondary.
Evidence: `.spur/run/0558-verify-answer.txt` row `| Scenario: R4 — ... (Given ...) | MET | test | ...`; `0558-verdict.json` `acceptanceCriteria[].id` preserved the parenthetical; feature-check.ts `isScenarioVerified` matches `normalized scenario title, optional Scenario: prefix, or AC-N alias` — no parenthetical-stripping.
Measurable target: re-derive the 0558 verdict from the original (unfixed) answer file and confirm R4 verifies without surgery.
### Plan
- [ ] 1. Locate the verdict AC-row id construction (spur task verdict --from-answer) in packages/app
- [ ] 2. Add normalized matching (strip parentheticals / compare normalized forms) for AC row ids
- [ ] 3. Update sp-dev-verify answer schema guidance (one line: row id = exact scenario title)
- [ ] 4. Regression test: re-derive 0558's verdict from the original answer file → R4 verifies
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session log: ~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_*.jsonl (17:23:32-17:26:24 window)
- Evidence: .spur/run/0558-verify-answer.txt · .spur/run/0558-verdict.json
- Code: packages/app/src/services/feature-check.ts (`isScenarioVerified`, ~line 660-700)
- Report: docs/report/2026-08-14-E6-batch-forensic-report.md §2 RC4 / §4
### History
