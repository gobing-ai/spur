---
schema_version: 1
name: "Observability DX — run-start plan preview + EventBus step progress"
status: todo
template: feature-impl
created_at: 2026-06-24T03:52:29.297Z
updated_at: 2026-06-24T03:52:29.297Z
feature_id: H2
parent_wbs: "0109"
priority: P2
tags: ["observability", "dx", "eventbus", "design"]
---

## 0114. Observability DX — run-start plan preview + EventBus step progress

### Background

Covers 0109 R6 — the largest, least-bounded item (flagged for possible further split). implement steps run 5-9 min (300-530s measured) with NO progress signal — looks hung. The ObservableWorkflowAdapter EventBus exists but is unconsumed. Two parts: (a) RUN-START PLAN PREVIEW — at spur workflow run start, emit a concise plan of the states/steps about to run (leverage the dry-run transition walk) so the operator sees the round's plan; (b) STEP PROGRESS — consume the EventBus (workflow.action.started/finished) to surface a heartbeat/status on long agent.run steps. CLI-side now; the board consumes the same events later. Include a short DX design note for the broader observability surface.

### Requirements

- [ ] R1. Run-start plan preview: on `spur workflow run`, print the states/steps about to execute (reuse the dry-run transition walk) before the run starts.
- [ ] R2. Step progress: consume ObservableWorkflowAdapter EventBus (workflow.action.started/finished) to surface heartbeat/status on long agent.run steps; CLI-side, board-reusable.
- [ ] R3. Short DX design note (docs/design or 04_DESIGN) for the observability surface direction.
- [ ] R4. lint green; a real pipeline run shows the plan preview + live step progress (no more 5-9min blind spot); tests for the preview/progress logic.

### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### History
