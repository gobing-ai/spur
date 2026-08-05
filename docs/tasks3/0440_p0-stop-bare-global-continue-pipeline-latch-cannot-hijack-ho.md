---
template: feature-impl
schema_version: 1
name: "P0: stop bare global continue — pipeline latch cannot hijack host session"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["pipeline", "session", "h83", "p0"]
dependencies: ["0438"]
created_at: "2026-08-05T19:00:59.281Z"
updated_at: "2026-08-05T19:08:25.647Z"
---

## 0440. P0: stop bare global continue — pipeline latch cannot hijack host session

### Background

Observed on run b388a1e6: second test-fix used omp -c and resumed host session with pending workflow trace tool call. Latch __agentSession=open maps to bare continue without session isolation.

### Requirements
R1. AgentRunActionRunner must not set continue:true in a way that produces global resume-last against the host session store.
R2. Until full sessionId affinity lands, either force continue false + --no-session, or open into an isolated sessionDir so last-in-dir is pipeline-only.
R3. Regression test: simulate host mid-session marker; second agent.run must not surface host pending-tool stderr.
R4. Partial artifact/log must show argv without bare -c when isolation is active.
R5. Depends on ts-ai-runner sessionDir and/or temporary no-continue policy if link not yet ready — implement safest path that unblocks dogfood.
### Acceptance Criteria
```gherkin
@core
Scenario: R2 — Pipeline never resumes the host session
  Given a prior host-like session marker in the global omp store
  When two pipeline agent.run hops run for omp
  Then the second hop does not resume the host session
  And stderr does not contain the host pending tool call text
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: safety fix in packages/app workflow agent-run latch.
WHY: host pollution is a P0 correctness bug.
WHERE: agent-run.ts + tests.
### Plan
- [ ] Choose interim: no auto-continue OR sessionDir-only isolation
- [ ] Wire runner
- [ ] Regression test from b388a1e6 pattern
- [ ] Verify with omp
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
- 2026-08-05T19:08:25.647Z todo → cancelled (system)
