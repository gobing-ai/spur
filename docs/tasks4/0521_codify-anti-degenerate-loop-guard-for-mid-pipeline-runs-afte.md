---
template: standard
schema_version: 1
name: "Codify anti-degenerate-loop guard for mid-pipeline runs after compaction"
description: ""
status: cancelled
type: task
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T23:16:05.738Z"
updated_at: "2026-08-11T23:33:21.390Z"
---

## 0521. Codify anti-degenerate-loop guard for mid-pipeline runs after compaction

### Background
Forensic review invalidated this task's original diagnosis. The Pi session contains two separate
runaway assistant responses, but each is a single model response with no tool call between repeated
phrases—not an FSM retry loop. The persisted JSONL contains zero compaction events; both responses
used `volc/deepseek-v4-flash-ga-260731`, occurred at roughly 17–18% of the advertised context
window, and ended only when aborted by the operator.

The transcript cannot distinguish model decoding degeneration from repeated provider stream deltas,
because it stores only Pi's accumulated response. Raw stream-event capture in Pi/provider is required
for that attribution. Spur's inline driver, run-link, and task status did not generate the repeated
turns, so a Spur FSM pointer or transcript scanner would not fix the observed failure.

The run did expose a separate, reproducible Spur defect: `task show/path/update` resolve WBS values
across configured task folders, while `task check <wbs>` searches only the active folder; additionally,
a relative `--folder docs/tasks2` breaks project-root derivation for `file:line` anchors. That defect is
tracked by replacement task 0522. This task is cancelled rather than implementing a false root cause.
### Requirements
- [x] **R1 — Preserve the forensic verdict.** Record that the observed output was repeated inside
      single Pi assistant responses, with no evidence of a Spur FSM retry or persisted compaction.
- [x] **R2 — Reject unsupported remedies.** Do not add a Spur state pointer, transcript loop scanner,
      archive prohibition, or new CLI surface under this task.
- [x] **R3 — Route the confirmed defect.** Track configured-folder lookup and relative-folder
      normalization in replacement task 0522.
### Acceptance Criteria
```gherkin
Feature: Close an invalidated incident diagnosis without shipping speculative machinery

  Scenario: R1 — The recorded cause matches the session evidence
    Given the Pi session JSONL contains the two repeated-output incidents
    When the incident is reviewed
    Then each incident is identified as one assistant response with no tool call
    And no persisted compaction or Spur FSM retry is claimed

  Scenario: R2 — Unsupported mitigations are not implemented
    Given Spur cannot observe raw foreground Pi stream events
    When this task is closed
    Then no state pointer, transcript scanner, or archived-task prohibition is added

  Scenario: R3 — The reproducible Spur defect remains actionable
    Given task 0197 exposed inconsistent configured-folder handling
    When the invalid diagnosis is cancelled
    Then replacement task 0522 owns the verified CLI fix
```
### Q&A
**Q: Was the repeated output a real incident?**  
A: Yes. It occurred twice and required operator aborts.

**Q: Was it a post-compaction FSM loop?**  
A: No evidence supports that claim. The JSONL has no compaction entry, and repetition occurred
inside one assistant response rather than across driver turns.

**Q: Can Spur fix the underlying Pi/provider response degeneration?**  
A: Not from this repository. Attribution requires raw stream-event capture in the Pi/provider layer.

**Q: What remains in Spur scope?**  
A: The independently reproduced task-folder lookup inconsistency, now task 0522.
### Design
No implementation. The proposed `.spur/run/<run-id>.state.json` and transcript-pattern gate are
rejected because neither sits on the observed failure path. A foreground Pi response can degenerate
before emitting any tool call, outside Spur's inline-driver execution boundary.

The confirmed CLI defect is deliberately separated into task 0522 so its implementation and tests
do not encode this task's disproven causal story.
### Plan
- [x] Inspect the authoritative Pi session JSONL and classify each repeated-output incident.
- [x] Reproduce the independent configured-folder failures with source-local Spur commands.
- [x] Reject the original causal claims and speculative Spur remedies.
- [x] Create implementation-ready replacement task 0522 for the confirmed Spur defect.
- [x] Cancel 0521.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Pi session `2026-08-11T18-23-37-890Z_019ff210-d7a2-77a1-bae8-0a4e57fc45fc.jsonl`
  - assistant message `c55710bb`: one aborted response, no tool call, repeated output
  - assistant message `b4397165`: one aborted response, no tool call, repeated output
- Task 0197 — archived-folder reproduction context
- Task 0522 — confirmed Spur configured-folder fix
- Installed Pi runtime: `@earendil-works/pi-coding-agent@0.84.1`
### History
- 2026-08-11T23:17:14.407Z backlog → todo (system)
- 2026-08-11T23:31:21.874Z todo → cancelled (system)
