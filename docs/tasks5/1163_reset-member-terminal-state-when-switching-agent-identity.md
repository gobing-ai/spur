---
schema_version: 1
name: Reset member terminal state when switching agent identity
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:32.317Z
updated_at: "2026-10-10T07:30:37.658Z"
feature_id: G63

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1163. Reset member terminal state when switching agent identity

### Background

Reusing MemberTerminal for a different member retains prior output, input, status and last sequence; beta replay below alpha sequence is dropped Evidence: `apps/web/src/modules/projects/MemberTerminal.tsx:143`; `apps/web/src/modules/projects/MemberTerminal.tsx:150`; callers `apps/web/src/modules/projects/MemberDetail.tsx:386` and `apps/web/src/modules/projects/ProcessesView.tsx:559`. Review a71c confirmed this using render alpha output sequence 100, rerender beta, deliver beta sequence 20; beta connected with sinceSeq=100 and displayed alpha output. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Key member terminal instances by the selected agent instance identity at both callers so React resets identity-owned state and closes the previous stream
- [ ] R2. Reconnecting to the same member preserves its sequence cursor and cleanup cancels old timers and streams
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given alpha terminal output, typed input and sequence 100 followed by selecting beta
  When beta sends its replay beginning at sequence 20
  Then beta displays only beta output, starts a fresh cursor and has cleared input and prior status

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given a transient disconnect and reconnect for the same member
  When the existing supported operation executes
  Then Reconnecting to the same member preserves its sequence cursor and cleanup cancels old timers and streams
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Key member terminal instances by the selected agent instance identity at both callers so React resets identity-owned state and closes the previous stream Chosen direction follows the existing local seams. Reject resetting only output while retaining the old replay cursor or changing only one caller. Targets: apps/web/src/modules/projects/MemberDetail.tsx; apps/web/src/modules/projects/ProcessesView.tsx; MemberTerminal.test.tsx and selection caller tests. Out of scope: terminal protocol changes, server replay storage, style redesign.

### Plan

1. Add a failing regression for AC1 using render alpha output sequence 100, rerender beta, deliver beta sequence 20; beta connected with sinceSeq=100 and displayed alpha output.
2. Implement the chosen direction in apps/web/src/modules/projects/MemberDetail.tsx; apps/web/src/modules/projects/ProcessesView.tsx; MemberTerminal.test.tsx and selection caller tests.
3. Run tests/modules/projects/MemberTerminal.test.tsx and selection switch tests from its workspace and confirm AC1 plus existing happy paths; run the project gate.

Read DESIGN.md. Verify instanceId is the declared stream identity in both caller types before adding keys; use the same identity sent as agentId. Include unmount/timer cleanup in the selection regression.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`apps/web/src/modules/projects/MemberTerminal.tsx:143`; `apps/web/src/modules/projects/MemberTerminal.tsx:150`; callers `apps/web/src/modules/projects/MemberDetail.tsx:386` and `apps/web/src/modules/projects/ProcessesView.tsx:559`

### History

- 2026-10-10T07:30:37.658Z backlog → todo (system)

