---
template: feature-impl
schema_version: 1
name: "P1: run-scoped session affinity default-on (vars, discovery, config knob)"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P1
tags: ["pipeline", "session", "affinity", "h83", "p1"]
dependencies: ["0438", "0440"]
created_at: "2026-08-05T19:00:59.285Z"
updated_at: "2026-08-05T19:08:25.854Z"
---

## 0441. P1: run-scoped session affinity default-on (vars, discovery, config knob)

### Background

Need runId→sessionId mapping so implement→fixall→review share one coding-agent session under .spur/run/<runId>/agent-sessions/<agent>, saving tokens. Default on for dogfood; disable via config/vars.

### Requirements
R1. On first successful agent.run (affinity on): sessionDir=.spur/run/<runId>/agent-sessions/<agent>; open durable session; discover sessionId; setVars __agentSessionId + __agentSessionDir; stamp invocation.sessionId.
R2. Later hops: pass sessionId+sessionDir into runTraced/PromptOptions (resume-by-id when supported).
R3. Default affinity ON for task-pipeline / workflow agent.run; disable via .spur/config.yaml (e.g. agent.sessionAffinity: false) and/or vars.sessionAffinity=false.
R4. Optional sidecar .spur/run/<runId>/agent-session.json for operators.
R5. Cost path: extractSessionId works when sessionId stamped.
R6. Works for matrix agents via capability degrade (fresh isolated if no resume-by-id).
R7. Pause/resume workflow continues affinity vars from effective-vars snapshot.
### Acceptance Criteria
```gherkin
@core
Scenario: R3 — Run-scoped session affinity default-on
  Given affinity default on and two agent.run hops same agent
  When both succeed
  Then both use the same sessionDir under the runId
  And the second hop resumes the first hop sessionId when the agent supports it
  And setting sessionAffinity false forces fresh non-global isolation or no-session
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: affinity controller in AgentRunActionRunner + AgentService invocation stamp.
WHY: token savings + correct continue semantics.
CONFIG: agent.sessionAffinity default true.
### Plan
- [ ] Config schema + load
- [ ] Open/discover/resume path
- [ ] Tests + omp dogfood
- [ ] Document disable knob
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
- 2026-08-05T19:08:25.854Z todo → cancelled (system)
