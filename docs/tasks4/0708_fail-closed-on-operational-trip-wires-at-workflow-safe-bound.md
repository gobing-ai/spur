---
schema_version: 1
name: "Fail closed on operational trip wires at workflow safe boundaries"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.669Z
updated_at: "2026-08-28T23:09:18.619Z"
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

- [ ] R1. Define a closed initial trip-wire catalog for retry exhaustion, hard-budget exceeded/unverifiable, required-capability denial, proof-state invalidation, and bounded-output drop/overflow.
- [ ] R2. Evaluate trip wires only at existing workflow/action safe boundaries; never inspect or mutate an agent subprocess concurrently without a supported cancellation mechanism.
- [ ] R3. A fired trip wire fails closed and routes through existing workflow failure semantics; it must never default to continue after a steering timeout.
- [ ] R4. Emit one canonical bounded `workflow.tripwire.fired` system event containing policy id/version, run/action/task correlation, threshold, observed value/state, and evidence references.
- [ ] R5. Reuse existing retry counters, budget results, capability results, proof comparisons, output bounds, event emitter, and redaction. Do not duplicate their state.
- [ ] R6. Trip-wire evaluation must be deterministic and table-driven; no model call or free-form policy DSL participates in the decision.
- [ ] R7. Preserve the failed worktree/artifacts for operator inspection and include the exact next decision required.
- [ ] R8. Add two-sided catalog/composition checks so a built-in high-risk signal cannot be emitted without a mapped trip wire, and stale mappings fail.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
