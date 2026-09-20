---
schema_version: 1
name: Measure complete-run reliability and execution cost across inline, pipeline, and fleet
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:03.724Z
updated_at: "2026-09-20T00:54:24.788Z"
feature_id: I31

priority: P1
dependencies: ["0903"]
ac_altitude: task-local
---

## 0905. Measure complete-run reliability and execution cost across inline, pipeline, and fleet

### Background

Type: `wayfinder:research`. This is the third investigation on map I31 and depends on 0903's contract/adoption inventory to choose representative scenarios. It measures complete-run reliability and execution cost across inline, pipeline, and fleet surfaces using existing evaluation, run, trace, session, and history tools. It produces evidence and a ranked observation set; it makes no code fixes and does not retry unknown outcomes automatically.

### Requirements

- [ ] R1. Consume 0903's settled scenario matrix and record the selected inline, pipeline, and fleet cohorts, execution mode, provider/executor, session reuse/fresh policy, and evidence provenance before measuring.
- [ ] R2. Exercise representative complete runs covering normal success, terminal failure, bounded recovery/fallback, receipt/run-identity freshness, reviewer isolation, and the session/context cases identified by 0903; do not invent scenarios unsupported by the inventory.
- [ ] R3. Measure completion and failure outcomes, retries/escalations, operator interventions, wall-clock/active duration, model/token/cost fields, and trace/session coverage where available. Report numerator, denominator, nulls, and unknowns separately.
- [ ] R4. Correlate run, stage, session, receipt, history, and cost evidence through existing joins; preserve unknown results when exact binding or sample sufficiency is absent.
- [ ] R5. Rank reliability failures, operator-attention costs, and measured economy opportunities with confidence, blast radius, existing owner, and the smallest candidate follow-up. Do not turn static graph counts into measured savings.
- [ ] R6. Deliver a scenario matrix and ranked reliability/cost observation artifact for the final I31 plan. Make no source, plugin, workflow, config, or test edits, and use no automatic retry when the outcome is unknown.

### Acceptance Criteria

- [ ] AC1 — The measured cohorts and scenarios are traceable to 0903's contract/adoption inventory and cover inline, pipeline, and fleet execution.
- [ ] AC2 — The artifact reports completion, failure, recovery, attention, duration, cost, and trace/session coverage with denominators and unknowns.
- [ ] AC3 — Run/session/cost joins preserve identity and receipt freshness; unbound or insufficient evidence is reported as unknown.
- [ ] AC4 — The ranked observations identify existing owners and follow-up candidates without code fixes, workflow/config edits, or automatic retries.

### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

Reuse the existing run logs, structured traces, session records, history/cost queries, and evaluation helpers. Start from 0903's measured contract boundaries, compare inline and explicit pipeline/fleet execution, and separate observed outcomes from inferred operator cost. Keep measurement correctness ahead of optimization; do not add telemetry or retry machinery for this study.

### Plan

- [ ] Read 0903's settled scenario and ownership matrix and freeze the measurement cohort.
- [ ] Run the smallest representative inline, pipeline, and fleet scenarios with run identities recorded.
- [ ] Collect terminal outcome, intervention, timing, token/cost, receipt, session, and trace evidence.
- [ ] Validate joins and sample sufficiency; retain unknowns and provenance.
- [ ] Publish the scenario matrix and ranked failure/cost observations for the final roadmap decision.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must reuse existing eval/trace commands, record exact run identities and exit status, and distinguish measured data from inference; no production test or code fix is claimed here.

### Review

Open until the investigation runs. Review must check scenario selection, identity/receipt binding, reviewer isolation, denominator/unknown semantics, and that cost or reliability claims are not inferred from static configuration alone.

### References

- Map: `docs/features/I31_post-delivery-spur-dev-improvement-roadmap-after-b6-b7-b8-and-g66.md`
- Depends on: task `0903` Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership
- Existing owners/tools: `docs/features/P_pipeline-dispatch-reliability.md`, `docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md`, `docs/features/E6_run-to-session-correlation-and-cost-path-repair.md`
- Measurement inputs: `.spur/run/`, existing workflow progress/trace/history/cost queries, `config/workflows/`, `docs/design/session-pinned-dispatch.md`

### History
