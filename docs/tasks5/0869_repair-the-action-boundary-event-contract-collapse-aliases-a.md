---
schema_version: 1
name: "Repair the action-boundary event contract: collapse aliases and correlate agent invocations"
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.224Z
updated_at: "2026-09-16T21:45:21.836Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - observability
  - events

dependencies: ["0868"]
---

## 0869. Repair the action-boundary event contract: collapse aliases and correlate agent invocations

### Background

The event vocabulary double-names one boundary: workflow.action.start and .started were each emitted 342 times, .done and .finished each 338 — so any count of action boundaries is doubled unless the reader knows to pick one. Separately, 276 of 443 agent.invoke.start events carry a NULL run_id, so the single most expensive thing a run does cannot be attributed to the run that paid for it.

### Requirements

- [x] R1. Exactly one start event and one finish event are recorded per action execution.
- [x] R2. No two event names describe the same action boundary; the retired alias is deleted rather than kept as a silent duplicate.
- [x] R3. agent.invoke.start and agent.invoke.exit events record the non-null run id of the dispatching run.
- [x] R4. Existing consumers of the retired alias names are migrated in the same change; none is left reading a name that no longer fires.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R5 — Each workflow action emits exactly one start event and one finish event
    Given a workflow action executes once
    When its system_events rows are counted by event_name
    Then exactly one start event and one finish event are recorded for that action
    And no two event names describe the same action boundary

  @core
  Scenario: R6 — Agent invocation events carry the run they belong to
    Given an agent invocation dispatched from a workflow action
    When its "agent.invoke.start" and "agent.invoke.exit" events are persisted
    Then each event records the non-null run id of the dispatching run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Delete the duplicate rather than alias it (constitution: delete, don't layer) — a compatibility shim here would preserve exactly the double-count the task exists to remove. Pick the surviving name by which one existing consumers already read, and migrate the rest. For run correlation, thread the dispatching run id through the agent invocation path rather than inferring it at read time from timestamps; an inferred correlation is wrong precisely when runs overlap, which is when it matters.

### Plan

1. Enumerate emitters and consumers of both alias pairs.
2. Choose the surviving names; migrate consumers; delete the duplicate emissions.
3. Trace the agent invocation path to find where run id is dropped; thread it through.
4. Add a test asserting one start and one finish per action, and non-null run id on invoke events.
5. Note the vocabulary change in docs/design/event-tracking.md.

### Solution

Collapse the action-boundary aliases to the verb-form pair and thread the dispatching run id through the agent invocation path, so one action boundary gets exactly one start and one finish name and every `agent.invoke.*` event is attributable to the run that paid for it (ADR-117 §2.3). The engine-native `workflow.action.start`/`.done` are deleted at the engine bridge — filtered out before they reach the shared bus — while `workflow.action.started`/`.finished` (the names the CLI progress reporter, `trace-writer`, and run-log sink already read) survive as the single pair. The dispatching run id is computed once and stamped by the invoke bridge onto invoke payloads the AiRunner emits without one (the `version`/`auth` resolution probes); the prompt dispatch already carried it, and a caller-supplied correlation is never overwritten. The vocabulary change is recorded in `docs/design/event-tracking.md` (§4 and §11) and the alias-policy owner `docs/design/observability-contracts.md` §7.9.

| Change | Anchor |
| --- | --- |
| `dropRetiredActionBoundaryAliases` filters the retired `workflow.action.start`/`.done` names off the bridge; `withInvokeRouting` gains a `readCorrelation` seam that stamps the dispatching run id onto invoke payloads lacking one | `packages/app/src/services/event-bridge.ts:65` |
| Engine `run`/`resume` bridges compose `dropRetiredActionBoundaryAliases` under `withWorkflowIdentity`, so the retired aliases never reach the tap or SSE while every other engine-native name still flows | `packages/app/src/services/workflow-service.ts:745` |
| `runCorrelation` is computed once and threaded into both the invoke bridge and the `AgentExecutionLifecycle`, so resolution probes and the prompt dispatch share one run id | `packages/app/src/services/agent-service.ts:1002` |
| Retired names removed from the catalog and the presenter map — the surviving verb-form pair is the only action-boundary vocabulary | `packages/app/src/services/event-names.ts:347` |
| Bridge tests: retired aliases dropped and everything else passes; correlation stamped onto invoke payloads without one and never overwrites an existing one | `packages/app/tests/services/event-bridge.test.ts:154` |
| Catalog test asserts the retired aliases are absent from names and presenters, not merely unreferenced | `packages/app/tests/services/event-names.test.ts:195` |
| Server wiring test migrates to `workflow.action.started` and asserts the retired `workflow.action.start` is never persisted | `apps/server/tests/upstream-system-events-wiring.test.ts:192` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `dropRetiredActionBoundaryAliases` filters engine-native `workflow.action.start`/`.done` at the bridge (packages/app/src/services/event-bridge.ts:57) leaving the adapter's verb-form `workflow.action.started`/`.finished` as the single start/finish pair; test drops retired aliases and passes started/finished through (packages/app/tests/services/event-bridge.test.ts:218-237) |
| R2 | MET | Retired names deleted from BASE_CATALOG and SYSTEM_EVENT_PRESENTERS rather than aliased (packages/app/src/services/event-names.ts:347); test asserts they are absent from names and presenters (packages/app/tests/services/event-names.test.ts:195) and filter drops them off the bus (packages/app/tests/services/event-bridge.test.ts:218) |
| R3 | MET | `runCorrelation` computed once and threaded into both the invoke bridge and AgentExecutionLifecycle (packages/app/src/services/agent-service.ts:1002-1016); `withInvokeRouting` readCorrelation seam stamps the non-null run id onto invoke payloads lacking one (packages/app/src/services/event-bridge.ts:113-120); AgentRunCorrelation.runId is a required string; test stamps correlation into agent.invoke.start and never overwrites caller-supplied (packages/app/tests/services/event-bridge.test.ts:154-177) |
| R4 | MET | Consumers migrated to verb-form: server wiring test (apps/server/tests/upstream-system-events-wiring.test.ts:174), web components and system-events-tab tests (apps/web/tests/modules/observability/), system-event-envelope test (packages/app/tests/services/system-event-envelope.test.ts:21); runtime consumers already read verb-form (apps/cli/src/commands/workflow.ts:844, packages/app/src/workflow/trace-writer.ts:21, packages/app/src/observability/workflow-run-log-sink.ts:84); grep confirms no live source reads the retired names |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — Each workflow action emits exactly one start event and one finish event | MET | test | event-bridge.test.ts:218-237 (dropRetiredActionBoundaryAliases drops `workflow.action.start`/`.done`, passes `started`/`finished`/`node.enter` through); event-names.test.ts:195 (retired aliases absent from names and presenters); upstream-system-events-wiring.test.ts:192 (retired `workflow.action.start` never persisted) |
| Scenario: R6 — Agent invocation events carry the run they belong to | MET | test | event-bridge.test.ts:154-177 (correlation stamped onto agent.invoke.start lacking one; caller-supplied correlation never overwritten); agent-service.ts:1002 (runCorrelation computed once and threaded); tap extracts nested.runId (packages/app/src/services/system-event-tap.ts:202) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:17943dc2488402d0aa2aa834093ee43a13de3c33119f62e473f3e51572f67958 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T21:33:59.853Z todo → wip (system)
- 2026-09-16T21:45:20.425Z wip → testing (system)
- 2026-09-16T21:45:21.836Z testing → done (system)

