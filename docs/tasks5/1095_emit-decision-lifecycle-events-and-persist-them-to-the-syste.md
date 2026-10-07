---
schema_version: 1
name: Emit decision lifecycle events and persist them to the system event ledger
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.687Z
updated_at: "2026-10-07T01:02:58.169Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 6

---

## 1095. Emit decision lifecycle events and persist them to the system event ledger

### Background

Slices S1+S2 of docs/design/decision-observability-and-adoption.md §5. DecisionService.decide (packages/app/src/decision/decision-service.ts:182) serves catalog decisions but emits nothing, so maker reliability cannot be measured and feature P1 adoption has no evidence. Covers R4–R8.

### Requirements

- [ ] R1. Register `decision.start`, `decision.success`, `decision.failure`, `decision.end`, `decision.rejected` in BASE_CATALOG with presenters and a new `decision` SystemEventSource (SOURCE_PROFILES row, producer spur, subsystem decision).
- [ ] R2. Emit from DecisionService.decide via an optional injected bus and per-call context `{caller, correlation}`; order start → success|failure → end, or rejected alone; shared invocationId.
- [ ] R3. Payloads per design §3.2: metadata only (inputKeys, evidenceDigest, makerSource, catalogLayer), never input values or evidence text; maker errors redacted and bounded to 512 chars.
- [ ] R4. Emission is best-effort: a bus listener error never changes the decision result.
- [ ] R5. Attach attachSystemEventLedger in `spur decision run` (apps/cli/src/commands/decision.ts) and pass the run bus plus runId/workflowName/nodeId/wbs correlation from the workflow decide action.

### Acceptance Criteria

- [ ] AC1 — An accepted decision emits start, success and end events in order
- [ ] AC2 — A fallback decision emits start, failure and end events in order
- [ ] AC3 — A caller mistake emits decision.rejected before any maker call
- [ ] AC4 — Decision event payloads stay metadata-only and carry run correlation
- [ ] AC5 — Decision events persist to the system event ledger

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:46.355Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

### Design

Chosen: emit at the DecisionService seam (single path for CLI and, after task 1094, workflow decide) — no upstream ts-ai-decision hooks, the wrapper already holds every field. Rejected: instrumenting runDecide separately (double emission once 1094 routes it through the service). Invariants: failure means fallback served, not crash; presenter sets severity explicitly (warn, error for reason=error) since inferSeverity does not match `failure`; value is always a closed-vocabulary member so it may appear in payloads. Signature: `decide(id, input?, options?: DecideOptions & { context?: DecisionCallContext })`; `new DecisionService({..., bus?})`. Contract: docs/design/decision-observability-and-adoption.md §3.

### Plan

1. Write the failure list first: missing end on throw, rejected after start, payload leaking input values, listener error breaking decide, missing correlation.
2. Add catalog entries, presenters, source profile in packages/app/src/services/event-names.ts.
3. Add bus/context to DecisionService and getDecisionService; emit in decide.
4. Wire ledger in apps/cli/src/commands/decision.ts run; pass context from the workflow decide action.
5. E2E: `spur decision run task-triage` with no backend → system_events rows start/failure/end under source decision.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
