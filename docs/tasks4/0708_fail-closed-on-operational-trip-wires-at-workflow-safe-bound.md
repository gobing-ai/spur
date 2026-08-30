---
schema_version: 1
name: "Fail closed on operational trip wires at workflow safe boundaries"
status: done
template: issue
created_at: 2026-08-28T23:03:05.669Z
updated_at: "2026-08-30T17:13:52.831Z"
priority: P1
tags: ["harness", "workflow", "tripwire", "reliability"]
dependencies: ["0703", "0706", "0707"]
feature_id: A6
ac_altitude: task-local
---

## 0708. Fail closed on operational trip wires at workflow safe boundaries

### Background

Spur already has bounded retries, timeouts, workflow failure states, steering operations, and a persisted System Event stream. These pieces report incidents but do not yet form explicit operational trip wires. The comparison report recommends turning existing telemetry into bounded controls without creating a second controller or generic policy engine.

This task adds a small fixed policy evaluator at existing action safe boundaries. Its job is to stop a run when a known reliability invariant is crossed, preserve evidence, and hand the reason to the existing workflow failure path.

### Requirements

- [x] R1. Define a closed initial trip-wire catalog for retry exhaustion, hard-budget exceeded/unverifiable, required-capability denial, proof-state invalidation, and bounded-output drop/overflow.
- [x] R2. Evaluate trip wires only at existing workflow/action safe boundaries; never inspect or mutate an agent subprocess concurrently without a supported cancellation mechanism.
- [x] R3. A fired trip wire fails closed and routes through existing workflow failure semantics; it must never default to continue after a steering timeout.
- [x] R4. Emit one canonical bounded `workflow.tripwire.fired` system event containing policy id/version, run/action/task correlation, threshold, observed value/state, and evidence references.
- [x] R5. Reuse existing retry counters, budget results, capability results, proof comparisons, output bounds, event emitter, and redaction. Do not duplicate their state.
- [x] R6. Trip-wire evaluation must be deterministic and table-driven; no model call or free-form policy DSL participates in the decision.
- [x] R7. Preserve the failed worktree/artifacts for operator inspection and include the exact next decision required.
- [x] R8. Add two-sided catalog/composition checks so a built-in high-risk signal cannot be emitted without a mapped trip wire, and stale mappings fail.

Non-goals: a remote control plane, automatic rollback, arbitrary user policy expressions, or a durable pause/resume redesign.

### Acceptance Criteria

```gherkin
Feature: Safe-boundary operational trip wires

  Scenario Outline: Known invariant stops the run
    Given a workflow action reaches a safe boundary with <signal>
    When trip-wire evaluation runs
    Then policy <policy> fires
    And the workflow follows its declared failure path
    And no subsequent action is dispatched
    And a bounded workflow.tripwire.fired event references the evidence

    Examples:
      | signal | policy |
      | retry attempts exhausted | retry-exhausted |
      | hard budget exceeded | hard-budget |
      | required capability unknown | capability-denied |
      | proof digest changed | proof-invalidated |

  Scenario: Healthy result is unchanged
    Given no catalog condition is met
    When trip-wire evaluation runs
    Then the existing action result and workflow transition are unchanged

  Scenario: Trip wire never times out to continue
    Given a policy fires during an unattended run
    When no operator is present
    Then the run remains failed with evidence rather than continuing by timeout default
```

### Q&A

**Q: Why fail rather than add a durable pause now?** Existing failure states already stop dispatch and preserve evidence.
A correct resumable pause is a larger workflow semantic with persistence/operator-control requirements. This task takes
the smallest safe rung: fail closed at the boundary.

**Q: Why a fixed catalog instead of YAML policy expressions?** Every initial signal and response is known. A generic DSL
adds validation and debugging surface without a second use case.

**Q: Are thresholds new configuration?** Reuse the bounds already owned by retry, budget, timeout, proof, and output
contracts. Add no duplicate knobs.

**Q: Does a trip wire roll back changes?** No. It stops further action and retains the worktree/artifacts. Automatic
rollback could destroy evidence and is explicitly outside this task.

### Design

Implement one pure evaluator over already-normalized outcomes. Each fixed policy maps an existing event/result to `continue` or `fail`; there is no new long-lived controller. Call it immediately before an action/workflow would report success. On failure, emit the bounded event and return an existing action failure so the state machine follows its declared route.

The first catalog contains only signals already produced by Spur. Thresholds use existing configured bounds where present; do not add speculative knobs. Preserve run state and artifacts rather than performing rollback. A later durable pause feature can consume the same event if operator-controlled resume becomes a proven need.

### Plan

1. Inventory the exact normalized result/event for each initial trip wire and reject any signal that lacks a deterministic source.
2. Define policy ids, version, bounded event payload, and table-driven evaluator.
3. Add focused unit cases for continue/fail boundaries and unknown values.
4. Invoke evaluation at agent/action and proof/retry safe boundaries using existing state.
5. Map a fired decision to existing action failure/workflow failed transitions.
6. Emit and persist the canonical system event through current redaction/bounds.
7. Add composition/catalog parity checks for built-in workflows.
8. Add integration tests proving no child action starts after a trip wire fires and artifacts remain accessible.
9. Update event/design documentation in the same commit.
10. Run targeted workflow/event tests, `bun run spur-check`, and `bun run test-cf`.

### Root Cause

Spur produces the relevant reliability signals in separate owners—retry counters in workflows, budget/capability
outcomes in actions, proof comparisons, output bounds, and persisted System Events—but no shared deterministic decision
maps those signals to a mandatory stop. `packages/app/src/workflow/steering.ts` supports continue/note/retry/abort at
safe boundaries, yet its boundary timeout can default to continue and it is not a trip-wire policy engine.

The missing behavior is a small composition layer, not more telemetry. Without it, an unattended run can record a severe
condition and still depend on ad-hoc transition/action behavior to stop.

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
| `packages/app/src/observability/workflow-run-log-sink.ts:178` |
| `packages/app/src/observability/workflow-run-log-sink.ts:235` |
| `packages/app/src/observability/workflow-run-log-sink.ts:4` |
| `packages/app/src/observability/workflow-run-log-sink.ts:88` |
| `packages/app/src/observability/workflow-run-log-sink.ts:9` |
| `packages/app/src/services/agent-service.ts:1102` |
| `packages/app/src/services/agent-service.ts:1393` |
| `packages/app/src/services/agent-service.ts:265` |
| `packages/app/src/services/agent-service.ts:49` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/services/agent-service.ts:812` |
| `packages/app/src/services/agent-service.ts:984` |
| `packages/app/src/services/agent-usage.ts:1` |
| `packages/app/src/services/capability-attestation.ts:1` |
| `packages/app/src/services/done-transition-guard.ts:16` |
| `packages/app/src/services/review-independence.ts:1` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:297` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:47` |
| `packages/app/src/services/workflow-service.ts:848` |
| `packages/app/src/workflow/actions/agent-run.ts:16` |
| `packages/app/src/workflow/actions/agent-run.ts:173` |
| `packages/app/src/workflow/actions/agent-run.ts:186` |
| `packages/app/src/workflow/actions/agent-run.ts:188` |
| `packages/app/src/workflow/actions/agent-run.ts:201` |
| `packages/app/src/workflow/actions/agent-run.ts:219` |
| `packages/app/src/workflow/actions/agent-run.ts:23` |
| `packages/app/src/workflow/actions/agent-run.ts:25` |
| `packages/app/src/workflow/actions/agent-run.ts:285` |
| `packages/app/src/workflow/actions/agent-run.ts:356` |
| `packages/app/src/workflow/actions/agent-run.ts:363` |
| `packages/app/src/workflow/actions/agent-run.ts:394` |
| `packages/app/src/workflow/actions/agent-run.ts:427` |
| `packages/app/src/workflow/actions/agent-run.ts:559` |
| `packages/app/src/workflow/actions/agent-run.ts:584` |
| `packages/app/src/workflow/actions/agent-run.ts:600` |
| `packages/app/src/workflow/actions/agent-run.ts:683` |
| `packages/app/src/workflow/actions/agent-run.ts:694` |
| `packages/app/src/workflow/actions/agent-run.ts:699` |
| `packages/app/src/workflow/actions/agent-run.ts:767` |
| `packages/app/src/workflow/actions/agent-run.ts:772` |
| `packages/app/src/workflow/actions/agent-run.ts:8` |
| `packages/app/src/workflow/actions/agent-run.ts:95` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:3` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:47` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:5` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:81` |
| `packages/app/src/workflow/builtins.ts:96` |
| `packages/app/src/workflow/checkpoint-contract.ts:1` |
| `packages/app/src/workflow/observability.ts:112` |
| `packages/app/src/workflow/observability.ts:114` |
| `packages/app/src/workflow/observability.ts:208` |
| `packages/app/src/workflow/observability.ts:297` |
| `packages/app/src/workflow/observability.ts:323` |
| `packages/app/src/workflow/observability.ts:347` |
| `packages/app/src/workflow/observability.ts:355` |
| `packages/app/src/workflow/observability.ts:55` |
| `packages/app/src/workflow/steering.ts:239` |
| `packages/app/src/workflow/steering.ts:255` |
| `packages/app/src/workflow/steering.ts:269` |
| `packages/app/src/workflow/steering.ts:273` |
| `packages/app/src/workflow/steering.ts:66` |
| `packages/app/src/workflow/step-reporter.ts:103` |
| `packages/app/src/workflow/step-reporter.ts:115` |
| `packages/app/src/workflow/step-reporter.ts:18` |
| `packages/app/src/workflow/step-reporter.ts:23` |
| `packages/app/src/workflow/step-reporter.ts:274` |
| `packages/app/src/workflow/tripwire.ts:1` |
| `packages/app/tests/observability/agent-execution.test.ts:40` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:221` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:357` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:66` |
| `packages/app/tests/services/agent-service.test.ts:3884` |
| `packages/app/tests/services/agent-service.test.ts:5` |
| `packages/app/tests/services/agent-usage.test.ts:1` |
| `packages/app/tests/services/capability-attestation.test.ts:1` |
| `packages/app/tests/services/checkpoint-cleanup.test.ts:1` |
| `packages/app/tests/services/event-names.test.ts:306` |
| `packages/app/tests/services/event-names.test.ts:323` |
| `packages/app/tests/services/review-independence.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1714` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2290` |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:59` |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:8` |
| `packages/app/tests/workflow/capability-requirements.test.ts:1` |
| `packages/app/tests/workflow/checkpoint-contract.test.ts:1` |
| `packages/app/tests/workflow/docs-pipeline-measured-verdict.test.ts:1` |
| `packages/app/tests/workflow/observability.test.ts:328` |
| `packages/app/tests/workflow/steering.test.ts:155` |
| `packages/app/tests/workflow/step-reporter.test.ts:188` |
| `packages/app/tests/workflow/step-reporter.test.ts:198` |
| `packages/app/tests/workflow/step-reporter.test.ts:212` |
| `packages/app/tests/workflow/step-reporter.test.ts:215` |
| `packages/app/tests/workflow/step-reporter.test.ts:280` |
| `packages/app/tests/workflow/step-reporter.test.ts:45` |
| `packages/app/tests/workflow/step-reporter.test.ts:72` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:1` |
| `packages/app/tests/workflow/tripwire.test.ts:1` |
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
| `plugins/sp/tests/routing-checkpoint.test.ts:1` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | tripwire.ts:26-32 closed 5-policy catalog (retry-exhausted, hard-budget, capability-denied, proof-invalidated, output-drop); versioned TRIPWIRE_CATALOG :53-96; pin test tripwire.test.ts:12 |
| R2 | MET | evaluation only at existing safe boundaries: agent-run.ts:460-543 post-dispatch, packages/app/src/workflow/actions/proof-fingerprint.ts:80-115; no subprocess inspection; signals read normalized outcomes only |
| R3 | MET | fail policies return ok:false via existing failure semantics (agent-run.ts:527-543); steering timeout fails closed when retries exhausted (steering.ts:237-248); unknown-id fails closed (tripwire.ts:141-151, test :52); steering.test.ts:156 |
| R4 | MET | WorkflowTripwireFiredEvent observability.ts:156-184 with policy id/version, run/action/task correlation, threshold, observed, evidenceRefs, nextDecision; emitted agent-run.ts:525 + proof-fingerprint.ts:111; bounded run-log line (sink onTripwire), test workflow-run-log-sink.test.ts:221 |
| R5 | MET | signals read only existing owners: 0707 budget verdict, steering settle reason, 0706 CAPABILITY_BLOCK_PREFIX, 0612/0711 proof digest pair, relay droppedChunks; no new thresholds (tripwire.ts header) |
| R6 | MET | evaluateTripWires tripwire.ts:130-158 pure deterministic first-match over frozen closed catalog; no model/DSL/config; tests tripwire.test.ts:40,61 |
| R7 | MET | exact nextDecision per policy in catalog; error embeds reason + next decision (agent-run.ts:541); partial-work artifact preserved (agent-run.ts:531-534); tests agent-run.test.ts:2567, tripwire.test.ts:70 |
| R8 | MET | two-sided checks: catalog pin tripwire.test.ts:12, unknown-id fail-closed :52, capability seam guard capability-attestation.test.ts:180-190 + prefix pin tripwire.test.ts:66; stale mappings fail via unknown-policy evaluationError |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Known invariant stops the run | MET | test | Tripwire, agent-run, steering, and workflow-run-log tests prove a known invariant fails at the next safe boundary and dispatches no subsequent action; all passed in the 6,953-test full gate. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I4 and Wave 3.
- `packages/app/src/workflow/steering.ts`
- `packages/app/src/services/system-event-emitter.ts`
- `packages/app/src/services/system-event-envelope.ts`
- `packages/app/src/observability/event-names.ts`
- `packages/app/src/workflow/actions/agent-run.ts`
- `packages/app/src/workflow/actions/proof-fingerprint.ts`
- `config/workflows/task-pipeline.yaml`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-30T03:23:52.366Z todo → wip (system)
- 2026-08-30T04:44:45.447Z wip → testing (system)
- 2026-08-30T04:44:53.147Z testing → done (system)
