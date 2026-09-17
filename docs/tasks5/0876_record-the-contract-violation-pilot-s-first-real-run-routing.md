---
schema_version: 1
name: Record the contract-violation pilot's first real-run routing decision
status: backlog
template: feature-impl
created_at: 2026-09-17T00:46:12.717Z
updated_at: "2026-09-17T00:46:23.213Z"
feature_id: D62

---

## 0876. Record the contract-violation pilot's first real-run routing decision

### Background

Task 0871 shipped the `contract-violation` transition guard and piloted it on `wrapup-pipeline` (R1-R4 and acceptance scenario R8 MET with executable evidence). Its R5 second conjunct - that the pilot edge's *behaviour* is recorded from real runs rather than fixtures - is structurally post-landing: the edge landed in 0871, so no real contract-violation routing decision could exist at certification time. The verify verdict for 0871 is PARTIAL on exactly that conjunct and is recorded as such, with the task landed through the F6 provenance override.

This task closes the accrual. The evidence path is already wired by 0871 and 0870: the run log's `[contract-violation]` transition trigger, the `workflow.agent.contract-violation` event line, and the action trace's `outcome`/`contract`/`observed` triple. What is missing is a real run in which a stage's declared contract is genuinely violated by a clean agent exit, so the routing decision - and the distinction from an executor failure - is observed on production data instead of a regression pin.

### Requirements

- [ ] R1. At least one real (non-dry, non-fixture) pipeline run records a `contract-violation` routing decision on the `wrapup-pipeline` pilot edge.
- [ ] R2. The recorded evidence names the violated contract, the observed value, and the transition trigger, taken from the run log and the action trace rather than a regression fixture.
- [ ] R3. The recorded evidence shows the executor-failure path was NOT taken for that run, so the two outcomes remain distinguishable on real data.
- [ ] R4. The first real-run measurement is fed to `bun scripts/spur-dev.ts promotion check` as the ADR-076 promotion input for spreading the pattern to the other `agent.run` stages.
- [ ] R5. If no real contract violation occurs within the retention window, the finding is recorded as such and the promotion decision is taken on the absence of traffic rather than on a fabricated fixture.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @edge
  Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry
    Given a stage whose output failed a declared contract check in a real pipeline run
    When the pipeline evaluates its outgoing transitions
    Then the run log records the contract-violation trigger for that run
    And the action trace records the violated contract and its observed value
    And the executor-failure path is not taken for that run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Observe, do not fabricate. The pilot edge only fires when an `agent.run` exits cleanly while violating a declared post-condition (`answerFile` / `expectFile` / `requireDiff`), which is deliberately rare. The work is therefore a bounded observation over recorded history, not an implementation: read the run log's transition trigger and the action trace's discriminator columns for `wrapup-pipeline` runs that post-date 0871's landing, and record what was actually observed. A zero-traffic outcome is a legitimate result and must be recorded as absence of traffic (R5) rather than backfilled with a constructed violation - the whole point of ADR-076's gate is that promotion is decided on measured real-run data.

### Plan

1. Enumerate `wrapup-pipeline` runs recorded after 0871 landed, from the project database (read-only).
2. For each, read the run log's transition trigger and the action trace's `outcome`/`contract`/`observed` values.
3. Record the first observed contract-violation routing decision with its contract, observed value and trigger (R1-R3), or record the absence of such a run.
4. Feed the measured figures to the promotion gate as its real-run input (R4).
5. Update 0871's R5 evidence note with the finding.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
