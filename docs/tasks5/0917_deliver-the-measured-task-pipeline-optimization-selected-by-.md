---
schema_version: 1
name: Deliver the measured task-pipeline optimization selected by 0912
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.301Z
updated_at: "2026-09-23T03:00:12.259Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w04
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914", "0915", "0912", "0913"]
---

## 0917. Deliver the measured task-pipeline optimization selected by 0912

### Background

0912 is complete. Its selected pilot is adoption of the existing inline action-emission and terminal-close contract, with a frozen 2026-10-06 decision date and a target of at least three real terminal inline runs. It did not select a faster graph: the cohort had no terminal inline DB rows, only one structured engine trace, and no session/cost joins. Task 0913 is also done and supplies the provenance and measured-versus-estimated evidence rules. First check whether the selected observability pilot has already been delivered under D62/P; do not implement it twice.

This task owns the D63 decision at the task-pipeline seam: establish a comparable post-adoption cohort, validate the selected observability outcome, and either propose one bounded speed candidate from that evidence or record why none is eligible. An observability improvement is not a measured speed improvement. No task-pipeline graph edit is required when the evidence is insufficient. Preserve ADR-107 activation eligibility, independent verification, role isolation, proof freshness and existing candidate expiry. Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md.

### Requirements

- [ ] R1. Check the 0912 inline tracing and terminal-close pilot against its frozen target and 2026-10-06 deadline using attributable real runs; reuse any completed D62/P implementation and report insufficient samples honestly.
- [ ] R2. Build a comparable task-pipeline cohort after instrumentation, separating definition digest, inline/engine/fleet mode, code/docs work, terminal/attempt identity, and known versus missing cost or duration evidence under 0913's contract.
- [ ] R3. Select at most one speed candidate only if the cohort identifies a repeatable bottleneck; predeclare its primary benefit metric, threshold, reliability floor, exclusions, sample requirement, owner and deadline before evaluation. Otherwise record INSUFFICIENT_EVIDENCE and the smallest bounded experiment.
- [ ] R4. Preserve admission, proof, independent review and verification, role/capability policies and full fallback on unknown dependency scope. Promote only on comparable real evidence through the existing process; retire an unproven candidate by its deadline without claiming speed gains.

### Acceptance Criteria

- [ ] AC1 — The 0912 observability pilot is evaluated against its original real-run target and deadline; missing runs or joins remain unknown, and D62/P work is not duplicated. (req: R1)
- [ ] AC2 — Every speed comparison names the comparable run cohort, definition/mode/change-class strata and known/total measurement coverage. (req: R2)
- [ ] AC3 — One eligible candidate has predeclared metrics and an expiry, or an explicit insufficiency verdict names the evidence gap and smallest experiment before any graph edit. (req: R3)
- [ ] AC4 — Existing safety and proof contracts pass on every reachable route; promotion requires the declared real benefit and reliability floor, while an unproven candidate retires. (req: R4)
- [ ] AC5 — Task optimization earns promotion (req: R4)

Feature-level traceability: this task delivers D63 scenario R4; AC1–AC4 give its task-local regression evidence. An insufficient-evidence outcome satisfies honest task completion but leaves speed adoption unclaimed.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The first gate is evidence, not a graph edit. Compare the 0912 frozen baseline with new real terminal inline runs and verify both action rows and run closure; no projection or replay substitutes for the pilot's three-run live claim. Use the 0913 provenance and coverage fields, and inspect whether 0914's installed bridge or later D62/P work already wires the driver. The current pilot improves observability; it creates the denominator needed to judge speed, but it cannot by itself establish lower latency or cost.

If the new cohort exposes a repeated avoidable model or repair cost, define one candidate using the existing route table and promotion registry. Preserve all current completion gates and compare like execution modes, change classes and definition digests. If no candidate clears the evidence floor, finish with a documented no-change decision and a named next measurement; this is a valid task outcome but does not claim the feature's speed aspiration was delivered. Do not add a standing v2 YAML or a new measurement service.

### Plan

- [ ] 1. Recheck 0912/0913 and later D62/P receipts; confirm the selected tracing/closure pilot's implementation and frozen live target by its deadline.
- [ ] 2. Collect the smallest comparable post-adoption cohort, with run IDs, definitions, modes, change classes, terminal evidence and explicit measurement coverage.
- [ ] 3. Decide whether one speed candidate is eligible. For an eligible candidate, freeze criteria before changing the graph and run safety/replay checks plus real comparison. For insufficient evidence, record the bounded next experiment and keep the current graph.
- [ ] 4. Resolve any candidate through the existing promotion or retirement path; update only affected task-pipeline callers, guidance and the outcome record.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:59.825Z todo → blocked (system)

