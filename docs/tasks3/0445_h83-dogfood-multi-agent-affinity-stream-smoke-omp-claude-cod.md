---
template: feature-impl
schema_version: 1
name: "H83 dogfood: multi-agent affinity+stream smoke (omp, claude, codex, agy, grok, pi)"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P2
tags: ["dogfood", "h83", "p2"]
dependencies: ["0440", "0441", "0442", "0443"]
created_at: "2026-08-05T19:00:59.306Z"
updated_at: "2026-08-05T19:08:26.676Z"
---

## 0445. H83 dogfood: multi-agent affinity+stream smoke (omp, claude, codex, agy, grok, pi)

### Background

After P0–P3, verify default-on affinity and streaming on the operator's real agent set before turning affinity off is considered.

### Requirements
R1. For each available agent among omp/claude/codex/agy/grok/pi, run a minimal two-hop agent.run workflow (or task-pipeline dry subset) with affinity on.
R2. Assert sessionDir isolation and no host hijack; assert run log receives mid-hop output when the agent emits it.
R3. Record skip with reason if an agent binary is not installed (not a fail).
R4. Document results under .spur/memory or task Solution; recommend keep affinity default-on or flip off based on evidence.
R5. No Phase D experiments.
### Acceptance Criteria
```gherkin
@core
Scenario: R4 (cancelled) — Multi-agent smoke matrix
  Given H83 P0–P3 landed
  When smoke runs for each installed matrix agent
  Then each result is PASS or SKIP with reason
  And no host-session pollution is observed on PASS rows
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: dogfood report + optional automated smoke script.
WHY: operator uses all six agents.
### Plan
- [ ] Smoke matrix checklist
- [ ] Run available agents
- [ ] Write findings
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
- 2026-08-05T19:08:26.676Z todo → cancelled (system)
