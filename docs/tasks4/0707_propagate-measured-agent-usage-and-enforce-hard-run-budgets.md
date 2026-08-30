---
schema_version: 1
name: "Propagate measured agent usage and enforce hard run budgets"
status: done
template: issue
created_at: 2026-08-28T23:03:05.651Z
updated_at: "2026-08-30T02:20:18.687Z"
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

- [x] R1. Define one normalized optional usage shape with availability, input/output/cache token counts, cost USD when measured, source, and measurement timestamp/version as applicable.
- [x] R2. Extend the owning `@gobing-ai/ts-ai-runner` facade first if native adapters expose structured usage; Spur consumes only typed fields and never parses human stdout/stderr for accounting.
- [x] R3. Propagate measured usage through `AgentRunResult`, `AgentRunTracedResult`, action results, and `agent.execution.finished` without changing `unavailable` into zero.
- [x] R4. Add optional per-action hard budgets for total tokens and cost; reuse existing `timeoutMs` for wall-clock rather than adding a duplicate duration setting.
- [x] R5. When a declared hard token/cost budget cannot be evaluated because usage is unavailable, fail closed at the action boundary with a specific `budget-unverifiable` result.
- [x] R6. When measured usage exceeds a hard budget, mark the action failed, emit a bounded budget event, and route through existing workflow failure semantics.
- [x] R7. Do not claim mid-run token termination without a structured streaming usage source; document enforcement as post-dispatch safe-boundary enforcement.
- [x] R8. Keep `config/pipeline-budgets.json` as the offline regression baseline; do not overload it as per-run runtime configuration.
- [x] R9. Preserve redaction and bounded-event contracts, including omission of raw prompts/output from usage events.

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
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:778` |
| `apps/cli/src/commands/workflow.ts:781` |
| `apps/cli/src/commands/workflow.ts:812` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:11` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:138` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:14` |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:45` |
| `apps/cli/tests/init-templates.test.ts:376` |
| `packages/app/src/observability/agent-execution.ts:153` |
| `packages/app/src/observability/agent-execution.ts:24` |
| `packages/app/src/observability/agent-execution.ts:256` |
| `packages/app/src/observability/agent-execution.ts:3` |
| `packages/app/src/observability/agent-execution.ts:52` |
| `packages/app/src/observability/agent-execution.ts:99` |
| `packages/app/src/observability/workflow-run-log-sink.ts:176` |
| `packages/app/src/observability/workflow-run-log-sink.ts:226` |
| `packages/app/src/observability/workflow-run-log-sink.ts:4` |
| `packages/app/src/observability/workflow-run-log-sink.ts:87` |
| `packages/app/src/services/agent-service.ts:1102` |
| `packages/app/src/services/agent-service.ts:1393` |
| `packages/app/src/services/agent-service.ts:265` |
| `packages/app/src/services/agent-service.ts:49` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/services/agent-service.ts:812` |
| `packages/app/src/services/agent-service.ts:984` |
| `packages/app/src/services/done-transition-guard.ts:16` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:297` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:47` |
| `packages/app/src/services/workflow-service.ts:848` |
| `packages/app/src/workflow/actions/agent-run.ts:17` |
| `packages/app/src/workflow/actions/agent-run.ts:253` |
| `packages/app/src/workflow/actions/agent-run.ts:357` |
| `packages/app/src/workflow/actions/agent-run.ts:414` |
| `packages/app/src/workflow/actions/agent-run.ts:439` |
| `packages/app/src/workflow/actions/agent-run.ts:455` |
| `packages/app/src/workflow/actions/agent-run.ts:538` |
| `packages/app/src/workflow/actions/agent-run.ts:608` |
| `packages/app/src/workflow/actions/agent-run.ts:613` |
| `packages/app/src/workflow/actions/agent-run.ts:8` |
| `packages/app/src/workflow/actions/agent-run.ts:88` |
| `packages/app/src/workflow/observability.ts:112` |
| `packages/app/src/workflow/observability.ts:114` |
| `packages/app/src/workflow/observability.ts:175` |
| `packages/app/src/workflow/observability.ts:262` |
| `packages/app/src/workflow/observability.ts:288` |
| `packages/app/src/workflow/observability.ts:312` |
| `packages/app/src/workflow/observability.ts:320` |
| `packages/app/src/workflow/observability.ts:55` |
| `packages/app/src/workflow/step-reporter.ts:103` |
| `packages/app/src/workflow/step-reporter.ts:115` |
| `packages/app/src/workflow/step-reporter.ts:18` |
| `packages/app/src/workflow/step-reporter.ts:23` |
| `packages/app/src/workflow/step-reporter.ts:274` |
| `packages/app/tests/observability/agent-execution.test.ts:40` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:327` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:66` |
| `packages/app/tests/services/agent-service.test.ts:3884` |
| `packages/app/tests/services/agent-service.test.ts:5` |
| `packages/app/tests/services/event-names.test.ts:306` |
| `packages/app/tests/services/event-names.test.ts:323` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1714` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2290` |
| `packages/app/tests/workflow/observability.test.ts:328` |
| `packages/app/tests/workflow/step-reporter.test.ts:188` |
| `packages/app/tests/workflow/step-reporter.test.ts:198` |
| `packages/app/tests/workflow/step-reporter.test.ts:212` |
| `packages/app/tests/workflow/step-reporter.test.ts:215` |
| `packages/app/tests/workflow/step-reporter.test.ts:280` |
| `packages/app/tests/workflow/step-reporter.test.ts:45` |
| `packages/app/tests/workflow/step-reporter.test.ts:72` |
| `packages/config/src/index.ts:209` |
| `packages/config/src/index.ts:307` |
| `packages/domain/src/dao/run-dao.ts:145` |
| `plugins/sp/hooks/context-hooks.test.ts:630` |
| `plugins/sp/hooks/context-post-tool.ts:2` |
| `plugins/sp/hooks/context-post-tool.ts:23` |
| `plugins/sp/hooks/context-post-tool.ts:287` |
| `plugins/sp/hooks/context-post-tool.ts:323` |
| `plugins/sp/hooks/context-session-start.ts:15` |
| `plugins/sp/hooks/context-session-start.ts:166` |
| `plugins/sp/hooks/context-session-start.ts:17` |
| `plugins/sp/hooks/context-session-start.ts:19` |
| `plugins/sp/hooks/context-session-start.ts:2` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1422` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1455` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1487` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1496` |
| `plugins/sp/scripts/stage-registry-adapter.ts:207` |
| `plugins/sp/scripts/stage-registry-adapter.ts:27` |
| `plugins/sp/scripts/stage-registry-adapter.ts:999` |
| `plugins/sp/tests/cli-surface-parity.test.ts:10` |
| `plugins/sp/tests/cli-surface-parity.test.ts:239` |
| `plugins/sp/tests/cli-surface-parity.test.ts:241` |
| `plugins/sp/tests/cli-surface-parity.test.ts:423` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:230` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-usage.ts:13-27` — `NormalizedAgentUsage`: `availability: 'measured' \| 'unavailable'`, input/output/cacheRead/cacheWrite tokens, `costUsd`, `source`, `measuredAt`, `unavailabilityReason`; fields set only when actually reported (`packages/app/src/services/agent-usage.ts:76-85`); tests `packages/app/tests/services/agent-usage.test.ts` (14 pass) |
| R2 | MET | `packages/app/src/services/agent-service.ts:812-818` — reads ONLY the typed `usage` field off the runner result; no stdout/stderr accounting parse anywhere (grep-verified). Conditional "if native adapters expose structured usage" is false today: installed `@gobing-ai/ts-ai-runner@0.4.46` exposes no structured usage (documented `docs/04_DESIGN.md:2261-2277`); no Spur-only parser workaround added |
| R3 | MET | `packages/app/src/services/agent-service.ts:266-271` (`AgentRunTracedResult.usage?`), `packages/app/src/services/agent-service.ts:816-818` (success normalize), `packages/app/src/services/agent-service.ts:1393` (lifecycle.finish usage), `packages/app/src/observability/agent-execution.ts:100-104` + `:256` (`AgentExecutionFinishedEvent.usage`, never zero), `packages/app/src/workflow/observability.ts:322-325` (data.usage projection), `packages/app/src/workflow/step-reporter.ts:275-279` |
| R4 | MET | `packages/app/src/services/agent-usage.ts:96-124` (`AgentBudgetOptions` + `parseAgentBudget` validation, string numbers accepted, ≤0/NaN rejected), `packages/app/src/workflow/actions/agent-run.ts:261-264` (trust-boundary validation); `timeoutMs` unchanged as sole duration control (`packages/app/src/services/agent-usage.ts:96`, `packages/app/src/workflow/actions/agent-run.ts:358`) |
| R5 | MET | `packages/app/src/services/agent-usage.ts:143-152` (unverifiable branches per cap), `packages/app/src/workflow/actions/agent-run.ts:368-371` (`budget-unverifiable (fail-closed)` message), test `packages/app/tests/workflow/actions/agent-run.test.ts:2347` |
| R6 | MET | `packages/app/src/workflow/actions/agent-run.ts:366-385` (evaluate + `workflow.agent.budget` event), `packages/app/src/workflow/actions/agent-run.ts:388-397` (partial-work artifact + `ok:false` through existing failure semantics), `packages/app/src/observability/workflow-run-log-sink.ts:176-186` (bounded log line), test `packages/app/tests/workflow/actions/agent-run.test.ts:2382` |
| R7 | MET | `packages/app/src/workflow/actions/agent-run.ts:357-360` ("Wall-clock (timeoutMs) stays the only mid-run control; token/cost caps are enforced after the dispatch returns"), `docs/04_DESIGN.md:2261-2277` ("Usage propagation and hard budgets (task 0707)" paragraph) |
| R8 | MET | `config/pipeline-budgets.json` + `scripts/commands/pipeline-budgets.ts` untouched — `git status --porcelain` clean for both; offline baseline role unchanged |
| R9 | MET | Budget event carries identifiers/scalars only — `packages/app/src/workflow/actions/agent-run.ts:372-384` (node/kind/agent/verdict/budget/violations; no prompt/output), `bound()` string caps `packages/app/src/services/agent-usage.ts:37-38`, redaction asserted in test `packages/app/tests/workflow/actions/agent-run.test.ts:2347` (`JSON.stringify(events[0])` not containing raw input) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Measured usage is propagated | MET | test | `packages/app/tests/workflow/observability.test.ts:330` — result `data.usage` reaches `workflow.action.finished` as measured `totalTokens:150, source:'test'`; `tests/observability/agent-execution.test.ts` finished-event usage shape |
| Scenario: Unavailable usage stays unknown | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:2402` — legacy no-budget action: `ok:true`, `data.usage` unavailable shape; `packages/app/tests/workflow/observability.test.ts:357` — missing usage → honest unavailable |
| Scenario: Hard budget cannot be hand-waved | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:2347` — maxTokens declared + unavailable usage → `ok:false`, `budget-unverifiable`, bounded event emitted (`verdict:'unverifiable'`) |
| Scenario: Exceeded measured budget fails | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:2382` — 1800 tokens vs cap 100 → `ok:false`, violations `1800 exceed maxTokens 100`, event `verdict:'over'` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | 4/5 claims DONE; 1 CHANGED (documented): "publish facade change before updating Spur" — precondition false (runner exposes no structured usage to publish); honest-unavailable contract established at Spur's seam instead, documented in `docs/04_DESIGN.md:2261-2277`; no parser workaround (respects the claim's intent) |
| P4 | Priority | — | Location |
| P4 | P3 | — | `packages/app/src/workflow/observability.ts:288-298` |
| P4 | P4 | — | `packages/domain/src/migrations.ts:803-817` |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
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
- 2026-08-30T01:00:26.240Z todo → wip (system)
- 2026-08-30T02:20:13.177Z wip → testing (system)
- 2026-08-30T02:20:18.687Z testing → done (system)
