---
schema_version: 1
name: Resolve operator gates as decision points under every profile
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T16:13:27.520Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - decision
  - hitl
estimate_hours: 3

dependencies: ["1231"]
---

## 1236. Resolve operator gates as decision points under every profile

### Background

Feature D65 F5. The operator agreed HITL gates become decisions under --auto. The binding already exists: hitl.* actions accept `decision: {mode: legacy|never|evidence, ...}` (decision-hitl-responder.ts, gate-evidence catalog, task 1099).

**Refine corrections (2026-10-17)**
- R2 "answered by evidence/catalog decision under profile=auto" → today every operator gate declares `decision: {mode: never}` (idea-pipeline.yaml:192, :343, :431, :499; task-pipeline.yaml:812) and auto is implemented by guards skipping the gate on vars (idea_approved, design_approved); the responder has no profile awareness (decision-hitl-responder.ts:18 DecisionMode legacy|never|evidence; evaluator returns delegate|accepted|deferred) → add profile wiring in the responder: interactive → delegate to operator; profile=auto → evidence/catalog decision.

### Requirements

- [ ] R1. Interactive profile: the responder delegates every gate to the operator regardless of declared mode.
- [ ] R2. profile=auto: each gate is answered by its declared binding — `mode: evidence` (statusVar → accepted/deferred) where an evidence status exists, else a catalog decision — and recorded via `spur decision`; on decision degrade the catalog default applies and is recorded as such.
- [ ] R3. Operator gates in migrated workflows declare an evidence or catalog binding (no `mode: never`); the auto-skip guards on idea_approved/design_approved are removed; validate rejects a gate without a binding.

### Acceptance Criteria

- [ ] AC1 — Operator gates resolve as decision points under every profile (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:27.115Z

- Profile → behavior (closed, refine 2026-10-17): interactive → operator; auto → evidence, else catalog decide; degrade → catalog default, recorded.

### Design

Configuration over code: gates declare `decision: {mode: evidence, statusVar: …}` where an evidence status file exists (e.g. design-check.status), else a catalog decide. The only code is a profile read in decision-hitl-responder.ts (vars.profile !== 'auto' → delegate) plus the lint beside collectHitlDecisionViolations (composition-lint.ts:345). Evidence-on-input stays rejected (parseDecisionConfig). Rejected: a new gate kind (duplicates the 0911 binding); keeping auto as guard skips (the gate never records a decision).

### Plan

- [ ] Failure modes: missing evidence node, decision maker unavailable, profile unset, input gate with evidence mode
- [ ] Profile switch in decision-hitl-responder.ts
- [ ] Lint rule beside collectHitlDecisionViolations
- [ ] Rebind gates in the fixture workflow (shipped workflows rebind in 1239/1241)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History
