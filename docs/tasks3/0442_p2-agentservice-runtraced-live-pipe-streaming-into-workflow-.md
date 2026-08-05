---
template: feature-impl
schema_version: 1
name: "P2: AgentService.runTraced live pipe streaming into workflow run log"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P1
tags: ["streaming", "observability", "h83", "p2"]
dependencies: ["0439"]
created_at: "2026-08-05T19:00:59.290Z"
updated_at: "2026-08-05T19:08:26.057Z"
---

## 0442. P2: AgentService.runTraced live pipe streaming into workflow run log

### Background

runTraced forces buffered mode so implement shows Working… then final text only after 19m. Need pipe-no-tty + existing lifecycle onOutput → workflow.agent → WorkflowRunLogSink.

### Requirements
R1. runTraced uses non-interactive pipe output (no TTY inherit, stdin ignore) via ts-runtime policy.
R2. onOutput still feeds AgentExecutionLifecycle; run log receives timestamped chunks before exit when child writes.
R3. Capture of final stdout/stderr for answerFile/partial artifacts still works.
R4. Tests with fake slow agent process.
R5. Docs: watch via spur workflow trace <id> --follow --output; ban | tail in execution-workflow observation examples.
### Acceptance Criteria
```gherkin
@core
Scenario: R5 (cancelled) — Live agent.run streaming without TTY
  Given a workflow agent.run with a child that emits lines over time
  When the run log is tailed during the hop
  Then intermediate lines appear before the hop finishes
  And stdin remains non-interactive
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: AgentService.executeRun output policy for nonInteractive path.
WHY: live dogfood observability.
DEPENDS: ts-runtime pipe-no-tty.
### Plan
- [ ] Switch runTraced policy
- [ ] Integration test with run log sink
- [ ] Update execution-workflow observation docs
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-05T19:08:26.057Z todo → cancelled (system)
