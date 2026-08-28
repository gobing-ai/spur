---
schema_version: 1
name: "Derive verified-result and correction-cost operational metrics"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.744Z
updated_at: "2026-08-28T23:09:19.640Z"
priority: P2
tags: ["harness", "history", "metrics", "verification"]
dependencies: ["0703", "0707"]
feature_id: A6
ac_altitude: task-local
---

## 0712. Derive verified-result and correction-cost operational metrics

### Background

Spur measures agent activity, history cost, duration, and run outcomes, but its primary operational success unit is not yet explicit: a task completed with valid verification and no subsequent corrective intervention. Raw token volume, dispatch count, or nominal done status cannot answer whether the harness produced a trustworthy result efficiently.

Existing task/run links, workflow records, verdict artifacts, history session links, and cost analytics provide the required joins. This task derives a truthful verified-outcome projection from those authorities and exposes it through the existing history analysis surface.

### Requirements

- [ ] R1. Define `verified result` as a task reaching done with a PASS verdict whose proof digest matches the final certified state; do not count force-done, missing verdict, synthetic verdict, PARTIAL, FAIL, or invalidated proof.
- [ ] R2. Define a correction as a verified task that is reopened, receives a post-verdict proof-input mutation requiring a new verification, or is superseded by a failed/retry run before stable completion. Keep the definition deterministic and documented.
- [ ] R3. Derive verified-result count/rate, verified-without-correction rate, correction count/rate, time to verified result, and retry-exhaustion count from existing task/run/workflow records.
- [ ] R4. Derive cost per verified result only from attributable measured history/run cost; return null plus coverage when cost is unavailable or only partially joined. Never coalesce absence to zero.
- [ ] R5. Include denominator, time window, source coverage, excluded-reason counts, and schema version so comparisons are auditable.
- [ ] R6. Extend the existing `history analyze --json`/report projection rather than adding a new public command or analytics store.
- [ ] R7. Queries must remain bounded by the requested window and use existing indexes/read models; no full raw-history scan on every Board request.
- [ ] R8. Add fixture-backed negative cases for force-done, missing/mismatched proof, reopen/correction, unlinked cost, duplicate imports, and partial coverage.
- [ ] R9. If the History Board exposes the projection, update contracts/server/web in one change and preserve nullable accounting semantics.

Non-goals: ranking individual developers/agents, treating activity as quality, inventing unavailable cost, or adding an external metrics platform.

### Acceptance Criteria

```gherkin
Feature: Verified-outcome operational metrics

  Scenario: Clean verified result is counted
    Given a task reaches done through a PASS verdict with matching proof digest and no later correction
    When history analysis covers that window
    Then verifiedResults and verifiedWithoutCorrection each increase by one
    And timeToVerified includes the task's bounded lifecycle duration

  Scenario: Nominal done is not enough
    Given a task is force-done or has a missing, synthetic, or mismatched verdict
    When metrics are derived
    Then it is excluded from verifiedResults
    And the corresponding excludedReason count increases

  Scenario: Correction is visible
    Given a verified task is reopened and reverified after a proof-input change
    When metrics are derived
    Then correctionCount increases and verifiedWithoutCorrection does not count the original result as stable

  Scenario: Missing cost remains unknown
    Given verified results exist but only some have attributable measured cost
    When costPerVerifiedResult is derived
    Then the value is nullable or based only on covered results with explicit coverage
    And absent cost is never rendered as zero
```

### Q&A

**Q: Why does this depend on verdict integrity?** A verified-result metric is only meaningful once PASS names one final
proof state. Before that, expose no historical retroactive certainty for weak/synthetic verdicts.

**Q: What is a correction?** Use observable lifecycle/proof events: reopen, post-verdict proof mutation followed by new
verification, or superseding failed/retry execution before stable completion. Do not infer developer intent.

**Q: How is partial cost handled?** Return nullable cost plus covered/total verified-result counts. A covered-subset value
must be labeled as such; absence is never zero.

**Q: Where should the metric appear?** Extend existing `history analyze --json` and its report. Add Board projection only
if it is the same DTO/query path, not a second implementation.

### Design

Add a verified-outcome fold to the existing history/domain analytics layer. Join canonical task-run links to terminal workflow records and verdict/proof evidence; then left-join history-run-session cost. Return a versioned block with counts, rates, duration distribution, nullable cost metrics, and explicit coverage/exclusion reasons.

Use the proof contract delivered by the verdict-integrity task as the eligibility gate. Correction classification is event/transition based, not inferred by a model. Preserve unknown accounting as null. Reuse current history read-model refresh if query cost warrants materialization; do not create a second pipeline by default.

Expose the block in existing history analyze JSON and its report renderer. Board exposure is included only if that surface already consumes the same summary DTO without a parallel query.

### Plan

1. Map task-run, workflow-run, verdict/proof, transition, history-session, and cost join keys with representative fixtures.
2. Freeze deterministic verified/correction/exclusion definitions in design docs and tests.
3. Implement the bounded domain query/fold with nullable cost and coverage.
4. Add the versioned result block to history service analyze output and report rendering.
5. Reuse or refresh existing read models only if measured query cost requires it.
6. Add fixtures for clean verified, corrected, force-done, failed, mismatched proof, duplicate, and uncosted cases.
7. Add schema/contract tests and Board projection only where the existing summary path makes it a small extension.
8. Validate real-data output with a source-local CLI and record provenance/coverage.
9. Update history analytics design and public JSON surface documentation.
10. Run targeted domain/service/CLI tests, `bun run spur-check`, `bun run test-cf` if transport changes, and one bounded real-data dry run.

### Root Cause

Current analytics center on sessions, agents, tokens/cost, duration, and workflow activity. They do not join those facts to
a strict verified-task outcome. A nominal task `done` can include force-done, missing/weak verdict evidence, or later
correction, while cost joins can be absent. Counting done tasks or coalescing missing spend to zero would therefore
overstate success and understate cost.

The underlying correlation already exists in task-run links, workflow/run records, verdict artifacts, history run-session
links, and cost analytics. The missing element is a deterministic outcome definition and one bounded fold over those
authorities.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I8 and Wave 3.
- `packages/domain/src/analytics/run-cost.ts`
- `packages/domain/src/analytics/pairings.ts`
- `packages/app/src/services/history-service.ts`
- `packages/app/src/services/workflow-service.ts`
- `packages/app/src/services/done-transition-guard.ts`
- `apps/cli/src/commands/history.ts`
- `docs/design/history-data-processing.md`
- `docs/design/run-record-contract.md`
- `config/pipeline-budgets.json`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
