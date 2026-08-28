---
schema_version: 1
name: "Propagate measured agent usage and enforce hard run budgets"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.651Z
updated_at: "2026-08-28T23:09:18.366Z"
priority: P1
tags: ["harness", "agent", "usage", "budget"]
dependencies: ["0706"]
feature_id: A6
ac_altitude: task-local
---

## 0707. Propagate measured agent usage and enforce hard run budgets

### Background

Live agent execution events currently emit `usage: 'unavailable'`, and `AgentRunTracedResult` carries only exit code, output, duration, and signal. Offline pipeline-budget checks exist, but they are retrospective regression sensors rather than runtime controls. The native `@gobing-ai/ts-ai-runner` result currently exposes no usage fields, so Spur must not fabricate token or cost measurements by scraping human output.

This task establishes an honest optional usage contract and enforces declared hard budgets at safe action boundaries. Wall-clock timeout remains the only mid-run control until a runner adapter provides structured streaming usage.

### Requirements

- [ ] R1. Define one normalized optional usage shape with availability, input/output/cache token counts, cost USD when measured, source, and measurement timestamp/version as applicable.
- [ ] R2. Extend the owning `@gobing-ai/ts-ai-runner` facade first if native adapters expose structured usage; Spur consumes only typed fields and never parses human stdout/stderr for accounting.
- [ ] R3. Propagate measured usage through `AgentRunResult`, `AgentRunTracedResult`, action results, and `agent.execution.finished` without changing `unavailable` into zero.
- [ ] R4. Add optional per-action hard budgets for total tokens and cost; reuse existing `timeoutMs` for wall-clock rather than adding a duplicate duration setting.
- [ ] R5. When a declared hard token/cost budget cannot be evaluated because usage is unavailable, fail closed at the action boundary with a specific `budget-unverifiable` result.
- [ ] R6. When measured usage exceeds a hard budget, mark the action failed, emit a bounded budget event, and route through existing workflow failure semantics.
- [ ] R7. Do not claim mid-run token termination without a structured streaming usage source; document enforcement as post-dispatch safe-boundary enforcement.
- [ ] R8. Keep `config/pipeline-budgets.json` as the offline regression baseline; do not overload it as per-run runtime configuration.
- [ ] R9. Preserve redaction and bounded-event contracts, including omission of raw prompts/output from usage events.

Non-goals: estimating provider prices from mutable public tables, scraping CLI text, a billing system, or a streaming kill switch unsupported by the runner.

### Acceptance Criteria

```gherkin
Feature: Honest live usage and runtime budgets

  Scenario: Measured usage is propagated
    Given a native runner returns structured token and cost usage
    When an agent.run action completes
    Then the action result and finished event carry the same measured values and source
    And no raw prompt or output is present in the usage payload

  Scenario: Unavailable usage stays unknown
    Given a runner exposes no structured accounting
    When an action with no token or cost budget completes
    Then usage is unavailable rather than zero and legacy success semantics remain unchanged

  Scenario: Hard budget cannot be hand-waved
    Given an action declares maxTokens
    And the runner returns unavailable usage
    When the action reaches its safe boundary
    Then it fails as budget-unverifiable and emits the bounded budget event

  Scenario: Exceeded measured budget fails
    Given measured total tokens exceed maxTokens
    When budget evaluation runs
    Then the action fails and the workflow follows its existing failure route
```

### Q&A

**Q: Can timeout already enforce a runtime budget?** Yes for wall clock, through existing `timeoutMs`. This task reuses
it and adds only token/cost budgets that require measured usage.

**Q: What if a provider reports tokens but not cost?** Preserve field-level availability. A token cap can be evaluated;
a hard cost cap is unverifiable and fails closed. Do not estimate mutable prices silently.

**Q: Can the process be stopped before it exceeds a token cap?** Not with the current buffered runner contract. Initial
enforcement occurs after dispatch at the action safe boundary. Mid-run termination is a later change only when structured
incremental usage exists.

**Q: Why fail when usage is unavailable?** Only actions that declare a hard token/cost budget fail. Legacy actions with
no such budget retain current behavior and report unavailable honestly.

### Design

Add a small normalized usage value object at the runner/application seam. Availability is explicit: `measured` carries only fields actually reported; `unavailable` carries a reason/source and no numeric zeros. Extend `agent.run` with optional `maxTokens` and `maxCostUsd`; retain `timeoutMs` for duration.

Budget evaluation occurs once when a dispatch returns. Exceeded or unverifiable hard budgets convert the action result to failure and emit a canonical bounded event. If a future runner exposes incremental typed usage, a later task may add mid-run cancellation without changing the normalized result shape.

The upstream package boundary is authoritative: if the installed runner cannot supply typed usage, implement and publish that facade change before updating Spur's dependency. Do not add a Spur-only parser workaround.

### Plan

1. Confirm structured usage availability for every supported native runner and document measured versus unavailable adapters.
2. Add the normalized usage contract and focused validation/serialization tests in the owning runner package when needed.
3. Update Spur's runner dependency and propagate usage through agent service and action result types.
4. Replace the literal unavailable event projection with the normalized shape.
5. Add `maxTokens`/`maxCostUsd` action option validation and a pure budget evaluator.
6. Apply the evaluator after dispatch and before action success is returned.
7. Emit bounded exceeded/unverifiable events and wire existing failure routing.
8. Add tests for measured within-budget, exceeded, unavailable, timeout, and legacy no-budget behavior.
9. Update design/config documentation and real-run observability examples.
10. Run upstream targeted tests, Spur action/event tests, `bun run spur-check`, and `bun run test-cf` if event transport changes.

### Root Cause

The installed `@gobing-ai/ts-ai-runner` defines `AgentRunResult` with exit code, stdout, stderr, signal, and duration only.
Spur's `AgentRunTracedResult` mirrors that limit, and `packages/app/src/observability/agent-execution.ts` hard-codes
`usage: 'unavailable'` on completion. Consequently, runtime code has no trustworthy token/cost value to compare against
a hard budget. `config/pipeline-budgets.json` and `scripts/commands/pipeline-budgets.ts` operate retrospectively and
deliberately skip null budgets; they are not runtime controls.

The root cause spans an owned dependency seam: typed native usage is discarded or unavailable before Spur sees the
result. Parsing human output inside Spur would replace an explicit unknown with fragile fabricated data and is rejected.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I2/I3 and Wave 3.
- `node_modules/@gobing-ai/ts-ai-runner/src/ai-runner.ts` — current `AgentRunResult` contract.
- `packages/app/src/services/agent-service.ts` — `AgentRunTracedResult` propagation.
- `packages/app/src/observability/agent-execution.ts`
- `packages/app/src/workflow/observability.ts`
- `config/pipeline-budgets.json`
- `scripts/commands/pipeline-budgets.ts`
- `packages/domain/src/analytics/run-cost.ts`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
