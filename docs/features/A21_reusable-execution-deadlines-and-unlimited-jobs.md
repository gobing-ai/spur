---
schema_version: 1
id: "A21"
name: "Reusable execution deadlines and unlimited jobs"
status: done
priority: P1
tags: []
created_at: "2026-09-08T22:26:58.093Z"
updated_at: "2026-09-09T04:50:05.297Z"
---

# A21: Reusable execution deadlines and unlimited jobs

## Goal

Provide reusable upstream execution deadlines and explicitly unlimited jobs, with cancellation and queue ownership that remain correct across scheduler, queue, and history execution.

## Scope

- In: upstream ts-infra shared execution policy and cancellation context for scheduler callbacks and queue attempts; native ts-runtime process-tree termination; cooperative importer cancellation; renewable ownership and stale-attempt fencing in ts-db/ts-infra; explicit null/none unlimited mode and inheritance.
- In: Spur adoption through released packages; one application default and compatibility resolver; history CLI validation; end-to-end termination, lease, retry, and SQLite cleanup regression evidence; documentation at each owning repository.
- Out: a replacement scheduler, new public Spur noun/verb, generic workflow/agent timeout migration, changes to SQLite busy timeout, production job replay, deployment, publication, and a claim that all database lock causes are resolved.
- Delivery boundary: this feature records cross-repository implementation work; upstream release availability gates Spur adoption. Publishing and unrelated dependency/toolchain changes are not authorized by planning approval.

## Acceptance Criteria

```gherkin
Feature: Reusable execution deadlines and unlimited jobs

  @core
  Scenario: R1 — Shared upstream policy governs actual execution
    Given a scheduler callback and a queued job have explicit execution budgets
    When each execution reaches its deadline
    Then the upstream infrastructure requests cancellation through the same execution contract
    And a scheduler callback that only enqueues does not substitute its elapsed time for the queued job deadline

  @core
  Scenario: R2 — Timeout values preserve inheritance and explicit unlimited mode
    Given timeout configuration is omitted, null, positive, or invalid
    When the upstream policy resolves the execution limit
    Then omitted values inherit and null disables this scope's deadline
    And zero, negative, fractional, non-finite, and unsupported timer values fail validation before work starts

  @core
  Scenario: R3 — Process cancellation reaps the complete child tree
    Given a shell descendant ignores SIGTERM and retains inherited output pipes
    When the process execution is cancelled or its finite deadline expires
    Then the native runtime escalates after the configured grace and reaps the owned process group
    And the result distinguishes timeout from external cancellation, signal, and normal exit

  @core
  Scenario: R4 — Import cancellation settles before reporting completion
    Given an importer is processing records under an abort signal
    When cancellation arrives during the import
    Then the importer stops scheduling further writes and settles transaction and checkpoint work before rejecting
    And no writes from that cancelled invocation occur after rejection

  @core
  Scenario: R5 — Unlimited jobs retain ownership beyond visibility intervals
    Given an unlimited job has a live owner and another consumer polls the same queue
    When execution exceeds multiple visibility intervals
    Then the owner renews its lease and no other consumer claims that live attempt
    And the job can complete normally without a hidden execution timer

  @core
  Scenario: R6 — Expired ownership cannot acknowledge a replacement attempt
    Given an old worker loses its renewable lease and another worker claims the job
    When the old attempt tries to renew, complete, or fail the job
    Then each stale mutation is refused using attempt ownership
    And expired work becomes recoverable without claiming arbitrary side effects are exactly once

  @core
  Scenario: R7 — Spur consumes one resolved native execution policy
    Given configured scheduler jobs and completion-triggered refreshes run in Spur
    When the server resolves configuration and registers handlers
    Then both handlers consume native policy with the same effective deadline and termination grace used by recovery
    And duplicated local timeout engines and age-only recovery of live attempts are removed

  @core
  Scenario: R8 — Unlimited execution reaches inherited history limits
    Given an operator explicitly selects unlimited execution for a history job
    When the job launches its child and default source imports
    Then the unlimited policy reaches inherited child and source limits without restoring the old default
    And an explicit finite inner limit or finite ancestor cancellation remains effective

  @core
  Scenario: R9 — Cancellation settles before retry and preserves shutdown controls
    Given a queue handler receives cancellation or the server starts shutdown
    When the worker coordinates settlement and retry
    Then the attempt is not retried while its owned cancellable work remains active
    And unlimited jobs remain manually cancellable and obey the separately selected shutdown drain policy

  @core
  Scenario: R10 — Existing consumers and configuration remain compatible
    Given an existing upstream consumer omits the new policy or a Spur user uses existing overrides
    When configuration is loaded
    Then upstream omitted defaults preserve existing behavior and Spur preserves its documented finite default and legacy precedence
    And the existing history CLI accepts none and rejects malformed numeric limits before importing

  @core
  Scenario: R11 — Timeout cleanup permits another SQLite writer
    Given a nested child holds a temporary SQLite write transaction and ignores SIGTERM
    When its finite execution deadline triggers native process-tree cleanup
    Then the child and descendants exit within the deadline plus grace tolerance and a second connection can write
    And an aborted incremental import can resume safely from its last committed checkpoint
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0810 | Move process-tree deadline and cancellation containment into ts-runtime | done |
| 0811 | Make history importer cancellation settle writes and checkpoints | done |
| 0812 | Add reusable scheduler and queue deadlines with renewable attempt ownership | done |
| 0813 | Adopt native execution policies across Spur scheduler and history jobs | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-08T23:51:31.654Z backlog → active (system)
- 2026-09-09T04:46:17.269Z active → verifying (system)
- 2026-09-09T04:50:05.297Z verifying → done (system)

