---
schema_version: 1
name: Prototype Projects conversation, agents, work, and global input interactions
status: todo
template: feature-impl
created_at: 2026-09-11T18:07:39.271Z
updated_at: "2026-09-11T18:08:05.634Z"
feature_id: G6
priority: P2
tags:
  - wayfinder:prototype

dependencies: ["0828"]
---

## 0830. Prototype Projects conversation, agents, work, and global input interactions

### Background

G6 replaces overlapping Workspace/Inbox/Teams navigation with one Projects context and connects GlobalAgentBar to a durable orchestrator conversation. Use runtime inventory evidence to make state displays honest. Existing GlobalAgentBar is UI-only. The requested open-design capability was unavailable during charting; use it if available in the prototype session, otherwise create a local reviewable artifact.

### Requirements

- [ ] R1. Produce a reviewable Projects prototype with Conversation, Agents, and Work views, existing project switching, role/executor/current-run detail, and contextual process/message inspection.
- [ ] R2. Exercise global input destination capture, task/feature references, receipt-before-clear, preserved failure drafts, duplicate submission, result navigation, and project switching during a pending request.
- [ ] R3. Show zero-agent, missing/offline orchestrator, rest-held request, unavailable executor, blocked work, failed delivery, and unknown execution-outcome states using explicit mock data.
- [ ] R4. Apply DESIGN.md and verify keyboard/IME behavior, status announcements, visible focus, and mobile layout. Provide route/control migration mapping and list operator feedback without treating the prototype as production.

### Acceptance Criteria

- [ ] R1: A linked prototype exposes the proposed three views and all retained operational capabilities in project context.
- [ ] R2: Interaction evidence covers each submission/switch case and prevents silent draft loss or cross-project delivery.
- [ ] R3: Every listed unavailable/held/failure state is inspectable and accurately labeled as mocked.
- [ ] R4: Accessibility/responsive checks and migration mapping are recorded; open feedback remains a design decision, not an implementation task.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Reuse existing Board components and tokens where practical. One project selector and one conversation authority; no nested team selector or new Inbox module. Keep source changes in an isolated prototype artifact rather than changing live navigation. Avoid new dependencies. Mocked backend behavior must be labeled.

### Plan

1. Read DESIGN.md, runtime findings, GlobalAgentBar, ProjectSwitcher, and existing Workspace/Inbox/Teams views.
2. Create the smallest reviewable prototype with shared conversation state and all R3 scenarios.
3. Exercise keyboard, IME, project switch, mobile, draft retention, and receipt/result flows; record evidence and unavailable checks.
4. Publish prototype location, control/route migration mapping, and feedback questions for Robin.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
