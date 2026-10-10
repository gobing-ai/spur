---
schema_version: 1
name: Preserve parent ledger ownership when nested sessions end
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:43.485Z
updated_at: "2026-10-10T07:29:47.546Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1159. Preserve parent ledger ownership when nested sessions end

### Background

Nested SessionStart reuses its parent pointer but nested SessionEnd unconditionally finalizes and deletes it, dropping later parent tool events Evidence: `plugins/sp/hooks/context-session-start.ts:105`; `plugins/sp/hooks/context-session-stop.ts:58`; `plugins/sp/hooks/context-session-stop.ts:88`. Review a71c confirmed this using parent start, nested start with SPUR_RUN_ID, child end, then parent tool event; pointer was absent and next event null. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Record session owner identity at pointer creation and allow only that owner to finalize or remove the pointer across Claude and Pi adapters
- [ ] R2. Owner shutdown emits exactly one session_end and nested starts continue reusing the parent ledger
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a parent ledger session and a nested reused child session
  When the child shuts down and the parent records another tool event
  Then the parent pointer remains and the event is persisted under the parent session

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given an owner ending its own session
  When the existing supported operation executes
  Then Owner shutdown emits exactly one session_end and nested starts continue reusing the parent ledger
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Record session owner identity at pointer creation and allow only that owner to finalize or remove the pointer across Claude and Pi adapters Chosen direction follows the existing local seams. Reject using SPUR_RUN_ID presence alone to skip every shutdown because an owner may carry that variable. Targets: plugins/sp/hooks/context-session-start.ts; plugins/sp/hooks/context-session-stop.ts; shared Pi adapter; hooks/context-hooks and Pi adapter tests. Out of scope: concurrent independent session redesign and new IPC.

### Plan

1. Add a failing regression for AC1 using parent start, nested start with SPUR_RUN_ID, child end, then parent tool event; pointer was absent and next event null.
2. Implement the chosen direction in plugins/sp/hooks/context-session-start.ts; plugins/sp/hooks/context-session-stop.ts; shared Pi adapter; hooks/context-hooks and Pi adapter tests.
3. Run tests/hooks/context-hooks.test.ts and affected Pi adapter tests from its workspace and confirm AC1 plus existing happy paths; run the project gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`plugins/sp/hooks/context-session-start.ts:105`; `plugins/sp/hooks/context-session-stop.ts:58`; `plugins/sp/hooks/context-session-stop.ts:88`

### History

- 2026-10-10T07:29:47.546Z backlog → todo (system)

