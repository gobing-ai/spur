---
schema_version: 1
name: Global input durable submission with receipt and result states
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.545Z
updated_at: "2026-09-12T04:56:46.142Z"
feature_id: G63
priority: P1
tags:
  - g6-program

dependencies: ["0841", "0832", "0833"]
---

## 0844. Global input durable submission with receipt and result states

### Background

`GlobalAgentBar` is the requirement's most visible gap: `handleSubmit` clears the prompt and shows
"Agent dispatch is not wired yet — this bar is UI only (F84 R6)"
(`apps/web/src/components/GlobalAgentBar.tsx:36-39`). It is mounted globally by `BoardLayout` across
every module route, so wiring it is a Board-wide behavior change, not a Projects-only one.

Two failure shapes drive the requirements. Clearing on submit destroys work if acknowledgement fails,
and clearing the whole field destroys a newer edit typed while the request was in flight — the
prototype fixes this by clearing only the submitted revision (R2-1…R2-7,
`docs/reports/g6-projects-prototype.md`).

"Accepted" must also stay honest: a persisted-but-unconsumed request is `queued-awaiting-orchestrator`,
not "working", and a zero process exit without workflow verification is `completed-exit-only`.
The durable receipt this consumes is delivered by G61.

### Requirements

- **R1** — Submission persists the request against the submitting project and returns a receipt before
  the UI acknowledges anything.
- **R2** — The composer clears only the submitted revision; a newer edit typed during flight survives.
- **R3** — A failed acknowledgement keeps the draft; resubmitting the same payload reuses the same
  request identity, and an edited payload mints a new one (G61's idempotency key).
- **R4** — A request submitted in one project lands only in that project, even if the operator
  switches projects mid-flight; a late result lands in its originating project.
- **R5** — Every non-nominal state is distinctly labeled with its next action:
  `queued-awaiting-orchestrator`, orchestrator-missing, orchestrator-offline, `rest-held`,
  `executor-unavailable`, `blocked`, `failed-delivery`, `outcome-unknown`, `completed-exit-only`.
- **R6** — `outcome-unknown` guidance is reconcile, never an unconditional retry button.
- **R7** — The same submission path and conversation are available on every Board route, not only
  inside Projects.

### Acceptance Criteria

```gherkin
Feature: Global input durable submission with receipt and result states

  @core
  Scenario: A submission becomes a durable request before acknowledgement
    Given the operator types into the global input on any Board route
    When the request is submitted
    Then the server persists it against the submitting project and returns a receipt
    And the composer clears only the submitted revision, preserving any newer edit

  @core
  Scenario: A failed submission never loses the draft
    Given acknowledgement fails
    When the operator resubmits the same payload
    Then the same request identity is reused with no duplicate request
    And an edited payload creates a new request

  @core
  Scenario: Project identity survives navigation
    Given a request submitted in one project
    When the operator switches projects before the result arrives
    Then the result appears in the originating project only
    And the other project's conversation and drafts are untouched

  @core
  Scenario: Every non-nominal state is named and actionable
    Given any of orchestrator-missing, orchestrator-offline, rest-held, executor-unavailable, failed-delivery, or outcome-unknown
    When the operator reads the receipt
    Then each state is distinctly labeled with its next action
    And a persisted-but-unconsumed request says so rather than showing progress

  @core
  Scenario: A run exit is never shown as a verified result
    Given a run that exited zero without workflow verification
    When its result renders
    Then it is labeled unverified and does not present the task as complete
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Complete interaction loop"
- Reference implementation: [projects prototype report](../reports/g6-projects-prototype.md) R2-1…R2-7 capture/draft/idempotency/late-result/rehydrate
- Code: `apps/web/src/components/GlobalAgentBar.tsx:36-39` (stub submit), mounted by `BoardLayout`
- Backend dependencies: tasks 0832 (idempotency key) and 0833 (completion receipt)

### History
