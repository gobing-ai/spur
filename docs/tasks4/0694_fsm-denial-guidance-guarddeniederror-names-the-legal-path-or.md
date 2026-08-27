---
schema_version: 1
name: "FSM denial guidance: GuardDeniedError names the legal path or the command that reaches it"
status: todo
template: feature-impl
created_at: 2026-08-27T19:45:00.042Z
updated_at: "2026-08-27T19:48:06.708Z"
feature_id: F94
priority: P2
---

## 0694. FSM denial guidance: GuardDeniedError names the legal path or the command that reaches it

### Background

`feature update F91 done` was denied during the 0688 session with "No transition from active to
done" — no hint that `feature sync` derives and walks the legal hop path (`active → verifying →
done`). Task transitions have the same silent-denial shape. The FSM is right to deny; the error is
useless. This task files friction G-4 of F94.

### Requirements

- [ ] R1. **Name the legal path(s) in `GuardDeniedError` messages.** When a transition is denied,
      the message lists the legal successor status(es) from the current status, and names the
      command that reaches them when one exists (e.g. `feature sync` or `feature advance --to`
      for multi-hop paths).
- [ ] R2. **Apply to both lifecycle FSMs.** Feature and task transitions share the error shape;
      both get the guidance.
- [ ] R3. **Tested.** Assertions on message content for the recorded denial cases, including the
      `active → done` example from the 0688 session.

### Acceptance Criteria

- [ ] AC1. Given a denied `feature update <id> done` from `active`, when the error renders, then
      the message names the legal hop path and/or the command that derives it.
- [ ] AC2. Given a denied task transition, when the error renders, then the same guidance shape
      applies.
- [ ] AC3. Given the test suite, when it runs, then denial messages are asserted to contain the
      legal-path guidance.

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
