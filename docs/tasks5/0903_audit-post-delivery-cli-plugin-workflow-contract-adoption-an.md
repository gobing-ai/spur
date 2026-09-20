---
schema_version: 1
name: Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:02.732Z
updated_at: "2026-09-20T00:55:10.140Z"
feature_id: I31

priority: P1
ac_altitude: task-local
---

## 0903. Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership

### Background

Type: `wayfinder:research`. This is the first independent investigation on map I31. It audits the post-delivery contract across the live `spur` CLI, plugin source, installed Superskill adapters, and workflow callers, then assigns confirmed drift and evidence gaps to existing owners. B6, B7, B8, and G66 are inputs; their completion is not re-verified here. This ticket produces an inventory and routing artifact, not a code fix.

### Requirements

- [ ] R1. Build a contract matrix for the relevant `spur agent` and `spur message` commands, `plugins/sp` skills/commands/scripts, installed generated adapters, `config/workflows`, and the cross-cutting session policy. Each row names the source path/line, asserted verb/flag/shape, live behavior or installed behavior, evidence command, and confidence.
- [ ] R2. Audit adoption of the shipped session and execution contracts, including `plugins/sp` execution-workflow prose around line 278, I7's semantic-drift backlog, `docs/design/session-pinned-dispatch.md`, and the live task/idea pipeline reuse/fresh and role-pinning points. Classify each finding as confirmed mismatch, stale guidance, adoption gap, or hypothesis to reproduce.
- [ ] R3. Inventory workflow callers, real-run evidence, and current owners for the definitions affected by D62. Explain the active-with-all-children-done state as an evidence/status question; do not auto-close D62 or any referenced feature.
- [ ] R4. Trace the operator journeys for agent and message dispatch through identity, idempotency, receipt, and error surfaces. Record simplification candidates without proposing a new public verb or silently removing compatibility.
- [ ] R5. Map each confirmed finding and candidate to an existing owner or backlog entry, including I7, P, D62, E6, B1, B3, G1, G4, G65, and I4 where evidence supports the relationship; identify duplicates and gaps.
- [ ] R6. Deliver a reviewable contract/adoption/ownership matrix in this task's Solution or linked run artifact, with command provenance, line anchors, unresolved questions, and the smallest follow-up slice for each confirmed finding. Make no source, plugin, workflow, adapter, or config edits.

### Acceptance Criteria

- [ ] AC1 — The inventory covers the live CLI, plugin source, installed adapter surface, workflow YAML callers, and session policy with path/line evidence.
- [ ] AC2 — Every finding has a disposition of confirmed mismatch, stale guidance, adoption gap, hypothesis, existing owner, or unresolved question; no hypothesis is reported as a bug.
- [ ] AC3 — The matrix preserves identity/idempotency/receipt constraints and records public-surface compatibility as an open decision where evidence is insufficient.
- [ ] AC4 — The artifact names the next owner or follow-up for each confirmed finding and records the D62 status/evidence gap without changing status.

### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

Read the smallest authoritative surfaces first: live CLI help/source, plugin contracts, installed generated adapters, workflow definitions/callers, and the named design references. Compare source assertions with behavior rather than rewriting prose from memory. Keep one matrix and one owner register so the later reliability measurement can select scenarios from evidence. Reuse I7, P, D62, and E6 ownership; do not create a parallel semantic-drift or reliability subsystem.

### Plan

- [ ] Freeze the post-delivery surface set and record source-local CLI provenance.
- [ ] Capture plugin/install/workflow/session assertions and compare each with the live contract.
- [ ] Audit agent/message journeys for identity, idempotency, receipts, and compatibility boundaries.
- [ ] Reconcile findings with existing feature/backlog ownership and D62's linked-task evidence.
- [ ] Publish the matrix, candidate dispositions, scenario inputs for 0905, and unresolved questions in the task artifact.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must record source-local commands, exit status, captured help/JSON provenance, and the distinction between observed behavior and inference; no implementation test or fix is claimed here.

### Review

Open until the investigation runs. Review must check that installed-versus-source drift is evidenced, hypotheses remain labeled, existing ownership is not duplicated, and no public surface or lifecycle status was changed.

### References

- Map: `docs/features/I31_post-delivery-spur-dev-improvement-roadmap-after-b6-b7-b8-and-g66.md`
- Existing ownership: `docs/features/I7_semantic-class-drift-layer-and-wayfinder-section-tags-fix.md`, `docs/features/P_pipeline-dispatch-reliability.md`, `docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md`, `docs/features/E6_run-to-session-correlation-and-cost-path-repair.md`
- Contract inputs: `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `plugins/sp/skills/spur-cli/`, `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `docs/design/session-pinned-dispatch.md`, `config/workflows/task-pipeline.yaml`, `config/workflows/idea-pipeline.yaml`

### History
