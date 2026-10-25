---
schema_version: 1
id: "G74"
name: "Faster fleet task execution with correlated warm turns"
status: verifying
priority: P2
tags: []
created_at: "2026-10-22T06:44:56.676Z"
updated_at: "2026-10-25T01:55:56.240Z"
---

# G74: Faster fleet task execution with correlated warm turns

## Goal

Reduce fleet task response and validated completion time by executing correlated task turns in warm Codex, Claude Code and Pi processes while preserving workflow contracts, independent review and durable recovery.

## Scope

- In: shared phase measurements and repeatable receipts; conversation-independent scheduling; correlated persistent task-turn lifecycle; Codex, Claude Code and Pi adapters; validated result/artifact accounting; cancellation, fencing and fallback; measured context/orchestration follow-up.
- In: explicit dependency on a released ts-ai-runner transport facade, without duplicate protocol implementations in Spur.
- Out: live-member binding owned by G75; arbitrary PID control; new public nouns or verbs; new cloud services; weakened checks or reviewer isolation; external-repository implementation in this planning run.
- Deferred: Grok Build and Antigravity CLI native adapters until exact-version capability probes establish support; generic existing resume/one-shot behavior remains available.

## Acceptance Criteria

```gherkin
Feature: Faster fleet task execution

  @core
  Scenario: R1 — A reproducible phase receipt compares all three first-batch agents
    # covers: I1, I4, I5, I6, I8
    Given the same bounded workload, binary provenance and executor settings for Codex, Claude Code and Pi
    When cold, resume and supported warm modes are compared
    Then a JSON receipt records phase timings, failures, completion rate, token and resource observations without dropping trials
    And the paired comparison reports p50 and p95 validated completion time and useful throughput with provisional targets distinguished from measurements

  @core
  Scenario: R2 — Task dispatch progresses during an orchestrator conversation
    # covers: I2, I5
    Given an eligible queued task, available capacity and an orchestrator conversation held for 30 seconds
    When the task becomes runnable while the conversation remains active
    Then dispatch occurs with p95 latency at most 1 second in the deterministic repeatable scenario
    And one fenced scheduling owner prevents duplicate dispatch

  @core
  Scenario: R3 — Claude Code completes keyed tasks in a warm process
    # covers: I2, I6
    Given a qualified Claude Code transport and two related keyed tasks
    When the worker executes the two tasks serially
    Then one process supplies correlated terminal outcomes and validated artifacts for both tasks
    And transport acceptance alone never records task success

  @core
  Scenario: R4 — Pi completes keyed tasks in a warm process
    # covers: I2, I6
    Given a qualified Pi RPC transport and two related keyed tasks
    When fragmented command responses and session events arrive while the worker executes them serially
    Then one process supplies correlated terminal outcomes and validated artifacts for both tasks
    And command acceptance is distinguished from completed task execution

  @core
  Scenario: R5 — Codex completes keyed tasks through native thread and turn identity
    # covers: I2, I6
    Given a qualified Codex App Server transport and two related keyed tasks
    When the worker starts and completes both native turns
    Then one process supplies thread and turn identities linked to each validated task receipt
    And native failed and interrupted outcomes cannot become successful task results

  @core
  Scenario: R6 — Warm process reuse preserves independent review and executor policy
    # covers: I2, I5, I6
    Given implementation context and a warm worker with resolved model, provider, tools, workspace and permission settings
    When an independent review or incompatible executor policy is selected
    Then the review uses fresh conversation state and an incompatible worker is not reused
    And required checks and reviewer independence remain unchanged

  @core
  Scenario: R7 — Uncertain accepted work is reconciled without duplicate side effects
    # covers: I2, I5
    Given a keyed writing task accepted by a worker under a pinned occupant generation
    When the connection disappears or a terminal event arrives after the generation changes
    Then the task remains uncertain until durable evidence resolves it and a stale result cannot certify success
    And cancellation, process death and retry evidence are preserved before any replacement writing task starts

  @core
  Scenario: R8 — Unsupported capabilities retain an explicit compatible fallback
    # covers: I4, I5, I6, I8
    Given an unsupported persistent capability or an unavailable released runner facade
    When the first-batch execution path or a second-batch capability probe is evaluated
    Then the result names a verified resume or one-shot fallback or an actionable unavailable prerequisite
    And Grok Build and Antigravity CLI remain second-batch native integrations and no duplicate transport is added to Spur

```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1273 | Fleet phase timing receipt and cold/resume baseline driver | done |
| 1274 | Conversation-independent orchestrator scheduling tick | done |
| 1275 | Correlated keyed task-turn seam with fencing and fallback | done |
| 1276 | Claude Code warm task-turn adapter | done |
| 1277 | Pi RPC warm task-turn adapter | done |
| 1278 | Codex App Server warm task-turn adapter | done |
| 1284 | ts-ai-runner correlated warm-turn session facade (upstream release) | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-22T19:34:57.719Z backlog → active (system)
- 2026-10-25T01:55:56.240Z active → verifying (system)

