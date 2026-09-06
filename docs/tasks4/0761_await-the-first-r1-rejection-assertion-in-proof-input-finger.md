---
schema_version: 1
name: "Await the first R1 rejection assertion in proof-input-fingerprint.test.ts"
status: cancelled
template: feature-impl
created_at: 2026-09-03T23:07:44.570Z
updated_at: "2026-09-05T00:57:43.196Z"
feature_id: D9
---

## 0761. Await the first R1 rejection assertion in proof-input-fingerprint.test.ts

### Background
This follow-up was created from 0751 review finding #2, then consolidated into 0760 R4 before separate implementation. It is intentionally cancelled so the identical assertion repair has one owner and one proof record.
### Requirements

- [ ] R1. `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`: the first R1 regression assertion `expect(createGitAlternateTree(...)).rejects.toBeInstanceOf(...)` is never awaited — add `await` (sibling tests use the awaited `.catch(e => e)` pattern). Without it, bun:test may settle before the matcher runs, so a regression back to the `''` sentinel could pass vacuously.
- [ ] R2. The test still fails against pre-0751 code after the fix (failure path stays exercised).

### Acceptance Criteria
- N/A — 0760 R4 owns the non-vacuous rejection assertion and its negative probe; 0761 has no independent delivery branch.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T00:51:32.045Z

- N/A — consolidation into 0760 was the final disposition.
### Design
No separate design. Reuse the existing awaited `.catch((e) => e)` assertion pattern owned by 0760 R4; adding a second implementation would duplicate the same one-line repair.
### Plan
- N/A — implemented and verified under 0760 R4; no separate change belongs to 0761.
### Solution
No separate production change. Task 0760 R4 owns the awaited rejection assertion at `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241`; its negative probe proves the assertion fails against the pre-0751 empty-string sentinel.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The duplicate was consolidated into 0760. `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-250` awaits the rejection through the sibling `.catch((e) => e)` pattern and asserts `ProofCaptureError`. The fresh `packages/app` verification set passed with 242 tests / 0 failures. |
| R2 | MET | A negative probe applied the repaired assertion to the pre-0751 empty-string sentinel and failed with `Received value: ""`, proving the assertion is non-vacuous; the current regression suite passes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | No production surface was required; the duplicate was consolidated into 0760. |
| P4 | secua-all | — | No security, correctness, usability, or maintainability blocker found. |
| P4 | full-project-gate | — | `bun run spur-check`: 7366 pass / 0 fail across 407 files. |
### References
- Owning task: 0760 R4
- Evidence: `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241`
### History

- 2026-09-04T00:00:48.700Z todo → cancelled (system)
