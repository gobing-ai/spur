---
schema_version: 1
name: Conversation view with per-project drafts and reference capture
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.543Z
updated_at: "2026-09-12T04:56:45.621Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0840"]
---

## 0841. Conversation view with per-project drafts and reference capture

### Background

No conversation surface exists. Inbox shows raw messages by endpoint
(`apps/web/src/modules/inbox/AllTab.tsx`, `AgentTab.tsx`, `SupervisorTab.tsx`), which is a queue
viewer, not a request/response thread.

The prototype models the target: human requests, orchestrator responses, holds, and result links in
one thread, with drafts retained per project and never leaking across projects
(`docs/prototypes/g6-projects/index.html`; scenarios R2-1…R2-7 and ST-1 in
`docs/reports/g6-projects-prototype.md`).

Submission itself lands in the global-input task; this task owns the thread, its rehydration, and
reference capture.

### Requirements

- **R1** — One thread per project showing human requests, orchestrator responses, hold reasons, and
  links to results.
- **R2** — Drafts are retained per project and never leak across projects; a project switch restores
  that project's draft.
- **R3** — Task and feature references are captured explicitly on the request, not parsed out of prose
  after the fact.
- **R4** — The thread rehydrates after a refresh from persisted requests and receipts, not from
  client-only state.
- **R5** — Corrupt or unavailable client storage degrades to an empty draft rather than breaking the
  view (prototype ST-1).
- **R6** — Reuses `/api/messages*`; no new client-side message store.

### Acceptance Criteria

```gherkin
Feature: Conversation view with per-project drafts and reference capture

  @core
  Scenario: Drafts stay with their project
    Given an unsent draft in one project
    When the operator switches to another project and back
    Then the draft is restored and the other project's draft is untouched

  @core
  Scenario: The thread survives a refresh
    Given requests and results in a project conversation
    When the Board is refreshed
    Then the thread rehydrates from persisted requests and receipts

  @core
  Scenario: References are explicit
    Given the operator references a task from Work
    When the request is submitted
    Then the reference travels as structured data on the request

  @core
  Scenario: Corrupt storage degrades safely
    Given unreadable client draft storage
    When the conversation opens
    Then it renders with an empty draft and no error state
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
- Reference implementation: `docs/prototypes/g6-projects/index.html`; [projects prototype report](../reports/g6-projects-prototype.md) R2-1…R2-7, ST-1
- Retained transport: `/api/messages*` (owner: G1)
- Code: `apps/web/src/modules/inbox/AllTab.tsx`, `AgentTab.tsx`, `SupervisorTab.tsx`

### History
