---
schema_version: 1
name: Align the review answer contract with the spur task verdict vocabulary
status: todo
template: issue
created_at: 2026-10-18T19:33:15.525Z
updated_at: "2026-10-18T19:33:34.802Z"

---

## 1254. Align the review answer contract with the spur task verdict vocabulary

### Background

Observed across every D66 batch run on 2026-10-18 (feature D66, tasks 1246-1249). The review hop's agent is asked to "end with exactly one plain `Verdict: PASS|FAIL` line, preceded by a `| Req | Status | Evidence |` table" (`config/workflows/task-pipeline.yaml`, review onEnter `input`), but `spur task verdict --from-answer` enforces a different, narrower vocabulary in `packages/app/src/services/verify-answer-lint.ts`:

- `ac-status` / req-status require `MET | PARTIAL | UNMET`; every reviewer wrote `PASS`, so the run's own verdict came out non-PASS.
- `ac-identity` requires the declared AC label exactly; reviewers appended the feature scenario (`AC1 / Scenario: R4 — …`, `AC2 (feature scenario R6 — …)`).
- `ac-evidence-type` requires `test | command | static-ref | manual-review | llm-judge | n/a` or a `+` compound; reviewers wrote `E2E test + source`, `code + test`, `bundle regeneration`.
- `confidence-mismatch` contradicts ADR-141: a reviewer that states `MEDIUM` for a carried residual is rejected because the linter derives `HIGH` from MET rows alone and cannot see the residual row.

Consequence in the batch: 4 runs (6078a8a6, bc16c064, 8e680e1e, db097057) reached review→remediate→review and ended `retry-exhausted` while the reviewer's own verdict was PASS, and every completed task (1246, 1247, 1249) needed an operator to rebuild the answer file from the task's `## Review` tables with the vocabulary normalized. On 1248 the reviewer had already written `.spur/run/1248-verdict.json` = PASS while the pipeline's own status token read FAIL.

Root cause is a contract split: two owners (the pipeline prompt and the lint) describe the same answer differently, and nothing checks the answer against the lint before the verdict is derived.

### Requirements

- [ ] R1. The review hop's `input` states the exact answer vocabulary the lint enforces: `MET | PARTIAL | UNMET` for Req and AC status, the enumerated evidence-type tokens, and that the AC column carries the declared AC label with no scenario suffix.
- [ ] R2. `spur task verdict --from-answer` accepts a declared AC identity in the forms reviewers actually produce — `ACn — <declared title>` and `ACn` alone — and rejects only a genuinely unknown criterion.
- [ ] R3. A reviewer answer that fails the lint is re-asked once with the failing findings named, instead of being converted into a review FAIL that burns the remediation budget.
- [ ] R4. `confidence-mismatch` honours ADR-141: a `MEDIUM` stated for a carried residual (an OPEN/DEFER row) is accepted, and the message names which row is responsible.
- [ ] R5. An end-to-end test drives one review answer with `PASS`-style prose plus a `## Review` table and asserts the run certifies without operator normalization.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
