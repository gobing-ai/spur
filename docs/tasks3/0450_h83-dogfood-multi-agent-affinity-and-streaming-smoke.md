---
template: feature-impl
schema_version: 1
name: "H83 dogfood: multi-agent affinity and streaming smoke"
description: ""
status: todo
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P2
tags: ["dogfood", "h83"]
dependencies: ["0448", "0449"]
created_at: "2026-08-05T19:09:03.876Z"
updated_at: "2026-08-05T19:24:47.343Z"
---

## 0450. H83 dogfood: multi-agent affinity and streaming smoke

### Background
After 0447–0449 land, validate H83 on the operator’s real agent set before considering turning affinity off. This is evidence gathering, not a fourth implementation of affinity.

**Depends on:** 0448 (affinity+stream runtime) and 0449 (surface/docs). 0447 is transitive via 0448.
### Requirements
R1. For **each installed** agent among **omp, claude, codex, agy, grok, pi**, run a minimal **two-hop** `agent.run` workflow (or equivalent short pipeline) with affinity **on**.

R2. Per agent, assert: (a) sessionDir under `.spur/run/<runId>/agent-sessions/`; (b) no host-session pollution; (c) run log shows mid-hop output **when the agent emits any** (note if agent is silent until end — not a fail if pipes work).

R3. Binary missing → **SKIP** with reason (not FAIL).

R4. Write results table into **Solution** (agent | installed | result | notes). Recommend keep affinity default-on vs disable based on evidence.

R5. No Phase D. No drive-by refactors. Prefer existing spur workflow + trace --follow --output for observation.
### Acceptance Criteria
```gherkin
@core
Scenario: R4 — Agent matrix: omp, claude, codex, agy, grok, pi
  Given H83 tasks 0447–0449 have landed
  When smoke runs for each of omp, claude, codex, agy, grok, pi
  Then each result is PASS or SKIP with reason
  And no host-session pollution is observed on PASS rows
  And Solution records the matrix and an affinity default-on recommendation
```
### Q&A
**Q: Must all six pass?** A: Only installed agents must PASS or have a product bug filed. Uninstalled = SKIP.

**Q: Can this task change production code?** A: Only trivial dogfood harness scripts if needed; affinity bugs → fix in 0448.
### Design
**WHAT — structured dogfood matrix, not product code.**

**Suggested smoke (per agent)**
1. Ensure 0447 packages linked; 0448/0449 shipped on branch.
2. `spur workflow run` a tiny state-machine with two sequential `agent.run` steps (or task-pipeline precheck+implement on a scratch task) with `vars.agent=<agent>`.
3. Confirm sessionDir + second hop resume/isolation via run log invocation lines.
4. Record PASS / FAIL / SKIP.

**Pass bar:** no host hijack; affinity paths used when agent supports them; streaming path does not regress shell live output; agent silence until exit is noted, not auto-fail.

**Output:** Solution table + optional `.spur/memory/` note. No new production feature flags unless a critical bug blocks dogfood (then file fix under 0448, not here).
### Plan
- [ ] Confirm 0447–0449 done and linked
- [ ] Build per-agent checklist
- [ ] Run smoke for each installed agent; SKIP others
- [ ] Fill Solution + Testing with evidence
- [ ] Affinity default-on recommendation
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: H83 · ADR-047
- Upstream: 0448, 0449 (and 0447 via 0448)
- Phase D: 0446 cancelled — out of scope
### History
