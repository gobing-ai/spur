---
schema_version: 1
name: Record the agent dispatch failure as the run terminal reason
status: todo
template: issue
created_at: 2026-10-18T19:33:17.168Z
updated_at: "2026-10-19T03:02:29.037Z"

feature_id: D3
priority: P2
ac_altitude: task-local
estimate_hours: 4
dependencies: []
---

## 1256. Record the agent dispatch failure as the run terminal reason

### Background

Valid cause-attribution gap: classifyTerminalReason has an agent.run branch, but all three production closure call sites omit actionKind (`packages/app/src/workflow/action-trace.ts:244,357` and `packages/app/src/workflow/observability.ts:520`). They pass only status/reason/errorText, so an immediate dispatch failure carrying an opaque error falls through to failed-check even when the failing action row identifies agent.run. The local DB contains both classified and unclassified historical failures; no historical rewrite is required to establish this code gap.

**Refine corrections (2026-10-18)**
- Retained: preserve the causal failing action identity at new-run closure and classify immediate agent failures correctly.
- Removed: dynamic terminal reasons containing stage/executor, six new reason classes, optional migrations and a reasonClass column. The current closed vocabulary already distinguishes failed-agent, failed-timeout, failed-check and failed-guard; action rows already hold node/error/agent details.
- Removed: the claim that every failed agent action must override the final run reason. A recovered failure followed by a gate failure, explicit cancellation or retry exhaustion must keep its actual terminal cause. Declared reasons intentionally have precedence; the current classifier test documents that.
- Removed: an asserted universal structured errorClass field; agent.run paths do not share such a field today. Reuse existing result.error/data and typed run statuses without inventing a cause taxonomy. Estimate unset → 4h.

### Requirements

- [ ] R1. A new run closing directly because its current agent.run action failed records failed-agent; a definite timeout records failed-timeout through the existing classifier. The associated action row retains the node, selected executor/agent and redacted error evidence.
- [ ] R2. Gate/guard failures, explicit declared terminal reasons, cancellation, interruption, paused-operator, retry exhaustion and outcome-unknown keep existing precedence and vocabulary. A previously recovered agent failure must not relabel a later unrelated close.
- [ ] R3. The persisted run terminal reason and workflow.run.finalized event report the same classification in inline and engine-backed execution. Existing callers that supply no reason retain their legacy null behavior.
- [ ] R4. Real persistence-adapter tests cover immediate agent failure, timeout, gate failure, recovered failure followed by a gate, explicit cancellation/retry bound, outcome-unknown and concurrent run isolation.

Out of scope: dispatch retry policy, quota/auth handling, new terminal enum members, database columns/migrations, Board UI redesign, historical DB repair and executor/model resolution.

### Acceptance Criteria

- [ ] AC1 — An immediate agent failure and timeout persist the existing specific terminal reasons (req: R1, R4)
- [ ] AC2 — Recovered failures and explicit lifecycle reasons retain the true terminal cause (req: R2, R4)
- [ ] AC3 — Event and stored reason agree across execution paths without cross-run leakage (req: R3, R4)

### Q&A

- Closed: preserve the nine-member TERMINAL_REASONS vocabulary and existing trace details; no migration.
- Closed: an explicit reason is not invalid just because an earlier agent action failed.
- Closed: unavailable structured classes are not inferred from provider-specific strings in this task.

### Design

Chosen: carry bounded, run-scoped causal action context through the existing persistence decorators and call classifyTerminalReason once with it; no new public API/schema. Reuse saveActionStart/saveActionFinalize boundary identity in WorkflowActionTraceWriter and equivalent observability action callbacks. Store only the current relevant identity/result fields; clear on recovery/progression/final close so a prior failure cannot poison a later one. If existing decorator composition can expose one classified closure value to both persistence and event emission, use it rather than adding independent classification rules. Read the actual wrapper order at the workflow service composition root before editing.

Precedence: explicit declared reasons and terminal/resumable status semantics stay authoritative; action kind refines only otherwise unclassified direct failures. Timeout remains the existing failed-timeout branch; outcome-unknown remains interrupted. Never pick the last historical failed row by a broad database query. No concatenated stage/executor in terminal_reason: trace/action rows are the detailed evidence.

Targets: `packages/app/src/workflow/terminal-reason.ts`, `packages/app/src/workflow/action-trace.ts`, `packages/app/src/workflow/observability.ts`; composition wiring only if necessary to avoid double classification. Tests: `packages/app/tests/workflow/terminal-reason.test.ts`, existing action-trace/observability adapter tests and one fake-agent workflow close fixture. Resolve the current run-record/observability owner from docs/04_DESIGN.md and update only changed semantics.

Dependencies: none; 1255 fixes dispatch input, 1260 owns failover policy, 1257 owns parking long-lived lifecycle rows. Preserve all three boundaries. Budget 4h; evidence is persisted run row plus matching emitted event, not only a helper unit test.

### Plan

- [ ] 1. Reproduce through the real decorator chain: failing fake agent action closes with failed-check despite kind agent.run; capture the stored row and finalized event (R1, R3).
- [ ] 2. Add regressions for recovered-failure/later-gate, concurrent runs, explicit cancel/bound, timeout and outcome-unknown precedence (R2, R4).
- [ ] 3. Thread current causal action context into the existing closure classifier and keep persisted/event classification identical; retain null/no-reason compatibility (R1-R3).
- [ ] 4. Run focused terminal-reason, trace, observability and workflow service tests inside packages/app; run app/CLI typechecks and a hermetic CLI trace probe (R4).
- [ ] 5. Update the owning contract, run task-local gate, then review/verify. Do not mutate historical run rows or taxonomy to make tests green.

### Root Cause

WorkflowActionTraceWriter already receives action kind, run/node identity and the final result at saveActionFinalize, but discards their causal context before finalizeRun. ObservableWorkflowAdapter classifies the same raw reason separately, also without action identity. Missing context makes the existing classifier's failed-agent branch unreachable through these ordinary closure paths. An arbitrary earlier failed action is not sufficient causal evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
