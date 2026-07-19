---
template: standard
schema_version: 1
name: "Harden pipeline agent.run against non-TTY slash-command stalls"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-18T23:42:14.007Z"
updated_at: "2026-07-18T23:42:42.972Z"
---

## 0295. Harden pipeline agent.run against non-TTY slash-command stalls

### Background
Task 0294’s timeboxed R5 investigation found that direct `spur agent run` capacity probes succeed while the task pipeline’s `agent.run` implement step can stall under both OMP and Codex. The recorded run directories had aged out, so the leading hypotheses are based on the live invocation paths: agent-specific slash-command translation, non-TTY stream mode, and the `__agentSession` continuation latch.

This follow-up owns the non-trivial diagnostic instrumentation and runtime hardening intentionally deferred from 0294. It must preserve the existing agent abstraction and workflow boundaries; no provider-specific workaround in `task-pipeline.yaml`.
### Requirements
- [ ] R1. Capture the resolved agent invocation before every workflow `agent.run`: agent, argv/translated prompt, cwd, output mode, timeout, continuation state, and whether stdin is interactive. Redact secrets and persist the event in the workflow run trace.

- [ ] R2. Reproduce the implement-step stall under a bounded fixture for at least one available agent, distinguishing slash-command translation, non-TTY behavior, and stale `__agentSession` continuation state with deterministic evidence.

- [ ] R3. Make pipeline `agent.run` non-interactive by contract so a translated `/sp:dev-run --mode implement … --auto` invocation cannot wait indefinitely for unavailable stdin. Preserve direct interactive `spur agent run` behavior.

- [ ] R4. Add regression coverage for timeout/cancellation cleanup and the resolved-invocation trace, including an actionable failure message that identifies the stalled agent step and its timeout.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
