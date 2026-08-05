---
template: feature-impl
schema_version: 1
name: "ts-runtime: non-interactive pipe output policy (no TTY) with live onOutput"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["ts-libs", "runtime", "streaming", "h83", "p0"]
dependencies: []
created_at: "2026-08-05T19:00:59.275Z"
updated_at: "2026-08-05T19:08:25.431Z"
---

## 0439. ts-runtime: non-interactive pipe output policy (no TTY) with live onOutput

### Background

Buffered execa path uses all:true and conflates non-interactive with end-buffered capture. Pipeline needs stdin ignore + no TTY inherit + live stdout/stderr data events for onOutput.

### Requirements
R1. Support an output policy that pipes stdout/stderr without TTY inherit (stream-like observation, non-interactive stdin).
R2. onOutput receives chunks as the child writes them, not only at process end.
R3. Document distinction: buffered (tests/capture), pipe-no-tty (pipeline), stream-with-tty (interactive CLI).
R4. Tests cover mid-process onOutput ordering.
R5. bun link @gobing-ai/ts-runtime into spur-new when unreleased.
### Acceptance Criteria
```gherkin
@core
Scenario: R5 — Live agent.run streaming without TTY
  Given a child that prints lines over time
  When run with pipe-no-tty policy and onOutput
  Then observers receive chunks before process exit
  And the child does not see a TTY on stdout
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: ProcessExecutor/NodeProcessExecutor output policy extension.
WHY: agent.run live log depends on it.
WHERE: ~/xprojects/ts-libs runtime package.
### Plan
- [ ] Design policy enum/shape
- [ ] Implement pipe-no-tty path
- [ ] Tests with slow-writing child
- [ ] bun link
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
- 2026-08-05T19:08:25.431Z todo → cancelled (system)
