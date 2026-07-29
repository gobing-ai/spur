---
template: feature-impl
schema_version: 1
name: "Catalog the 0365 observability envelope contract and preserve it through payload normalization"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "event-catalog", "data-plane"]
dependencies: []
created_at: "2026-07-29T00:14:02.988Z"
updated_at: "2026-07-29T00:25:16.647Z"
---

## 0367. Catalog the 0365 observability envelope contract and preserve it through payload normalization

### Background

Task 0365 built versioned correlated observability envelopes — schemaVersion, eventId, sequence, runId, executionId, actionId, node, kind, redacted metadata, durationMs, and an explicit `usage: 'unavailable'` — and emitted them on the WorkflowObservabilityBus (packages/app/src/workflow/observability.ts:111-121, packages/app/src/observability/agent-execution.ts:9-65). Two of those event names, `workflow.agent` (the unified AgentExecutionEvent lifecycle) and `workflow.steering` (SteeringAck), are absent from SYSTEM_EVENT_CATALOG entirely (packages/app/src/services/event-names.ts:77-153), so the tap never subscribes to them and the Board can never see them. Worse, `normalizeSystemEventPayload` (event-names.ts:205-221) is a shallow copy that blanks a fixed key list; it has no concept of the 0365 envelope and its policy branches were written before those fields existed. This task makes the catalog and the normalizer aware of the contract 0365 actually ships. It is the first task in J3 because the tiering, correlation, and bridge tasks all key off catalog entries.

### Requirements
- [ ] R1. Register catalog entries for the unified agent execution lifecycle (`started`, `output`, `heartbeat`, `dropped`, `finished`) with an appropriate source, renderer, tier, and payload policy.
- [ ] R2. Register a catalog entry for steering acknowledgements carrying operation, target, and outcome.
- [ ] R3. Extend `normalizeSystemEventPayload` so the 0365 envelope's correlation and metadata fields (schemaVersion, eventId, sequence, runId, executionId, actionId, node, kind, metadata, durationMs, usage, outcome, reason) survive normalization under every payload policy.
- [ ] R4. Keep redaction strictly ahead of persistence: configured secrets and the 0365 SECRET_PATTERN must not survive normalization, and bounding/truncation must not expose removed material.
- [ ] R5. Choose tiers deliberately — high-volume members of the lifecycle (notably `output` and `heartbeat`) must not become default-tier ledger noise; document the reasoning inline.
- [ ] R6. Do not change what the WorkflowObservabilityBus emits; this task adapts the catalog and normalizer to the existing producer contract.
- [ ] R7. Extend the producer audit table at docs/inventory/system-events-producer-audit.md with the new entries and their reachability status.
### Acceptance Criteria
```gherkin
Scenario: R8 — The unified agent lifecycle is a cataloged, observable event
Scenario: R9 — Steering acknowledgements are observable
Scenario: R10 — Envelope enrichment survives payload normalization
Scenario: R11 — Secrets never reach the ledger
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
