---
schema_version: 1
name: Migrate idea, wrapup and pr-review pipelines onto the foundation
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-17T16:13:52.444Z"
feature_id: D65
priority: P2
tags:
  - workflow
  - migration
estimate_hours: 4

dependencies: ["1240"]
---

## 1241. Migrate idea, wrapup and pr-review pipelines onto the foundation

### Background

Feature D65 P3. The remaining model-bearing workflows still depend on the inline driver; lifecycle workflows (task-lifecycle, feature-lifecycle) are out of scope.

**Refine corrections (2026-10-17)**
- R1 "idea-pipeline, wrapup-pipeline and pr-review still depend on the inline driver" → only idea-pipeline is inline-driven (dev-idea/dev-plan); wrapup (headless, dev-wrap.md:31 "no inline wrap driver"), pr-review (all shell), history-anatomy and wayfinder-resolution already run on the engine → port idea-pipeline only; verify the others pass the 1233 lint and fleet dispatch. Title kept (CLI cannot rename).
- Estimate 8h → 4h (one port instead of three).

### Requirements

- [ ] R1. idea-pipeline runs on the engine with host/subprocess/fleet dispatch (`vars.executor`) and passes the self-contained lint.
- [ ] R2. Operator gates of idea-pipeline, wrapup-pipeline and wayfinder-resolution carry evidence/catalog decision bindings; --auto behaves as today's recommendations.
- [ ] R3. wrapup-pipeline, pr-review, history-anatomy and wayfinder-resolution pass the self-contained lint and dispatch through the same agent.run contract (fleet included) without inline driving.
- [ ] R4. dev-idea and dev-plan driver references reduce to the run → work → continue loop.

### Acceptance Criteria

- [ ] AC1 — Remaining workflows migrate and the inline bookkeeping surface is removed (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Mechanical port of idea-pipeline using the P1 contracts; the other engine-run workflows need only rebinding and lint conformance. One E2E run of idea-pipeline (host executor) plus validate across config/workflows is the check. No new mechanism.

### Plan

- [ ] Port idea-pipeline; E2E under host executor
- [ ] Rebind gates and fix lint findings in wrapup, wayfinder, pr-review, history-anatomy
- [ ] Update dev-idea / dev-plan driver references

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
