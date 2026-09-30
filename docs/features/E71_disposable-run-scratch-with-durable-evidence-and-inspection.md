---
schema_version: 1
id: "E71"
name: "Disposable run scratch with durable evidence and inspection"
status: backlog
priority: P2
tags: []
created_at: "2026-09-30T19:53:48.380Z"
updated_at: "2026-09-30T19:56:12.150Z"
---

# E71: Disposable run scratch with durable evidence and inspection

## Goal

Make completed execution scratch safely disposable without losing verification evidence, retained run inspection, resumability, or historical analytics.

## Scope

In scope:

- Inventory every `.spur/run/` producer, consumer and one-off cleanup site across commands, workflows, tests and portable plugin surfaces; classify scratch, lasting data and derived caches.
- Move lasting evidence and retained run/session records outside scratch and redirect all readers, writers, references and worktree exports. Reuse F93's tracked Testing parser where appropriate without weakening proof checks.
- Preserve attempt freshness, atomic publication, run identity, confined paths and recovery while fixing or removing inappropriate dependencies.
- Migrate existing data without data loss and prove that deleting completed scratch after all consumers finish leaves acceptance, inspection and analytics unchanged.
- Update owning contracts and regenerate installed/plugin surfaces through their owners.

Out of scope:

- Automatic terminal cleanup steps in individual commands/workflows, new schedulers or retention frameworks.
- New public CLI nouns, verbs or flags; changing retention durations or weakening verification requirements.
- Deleting live project data during planning, rewriting unrelated historical tasks, or replacing existing evidence parsers/stores unnecessarily.

## Acceptance Criteria

```gherkin
Feature: Disposable run scratch with durable evidence and inspection

  @core
  # covers: I2, I3
  Scenario: R1 — Every run storage dependency and cleanup site has a disposition
    Given commands, workflows, plugin surfaces and tests that reference run storage directly or through computed paths
    When the ownership audit traces each producer and all consumers
    Then each reference has an owner, lifetime, cleanup behavior, disposition and verification check
    And one-off invalidation is distinguished from terminal housekeeping and unrelated temporary storage

  @core
  # covers: I1, I3, I4
  Scenario: R2 — Task and feature evidence remains valid without completed scratch
    Given recorded task verdicts, proof identities and feature verification receipts
    When completed scratch is removed after evidence persistence and all consumers finish
    Then task and feature acceptance and verified-outcome analytics produce the same results
    And missing, malformed, stale, divergent or superseded evidence still cannot satisfy completion

  @core
  # covers: I1, I3, I4
  Scenario: R3 — Retained run inspection and artifact references survive scratch removal
    Given terminal logging-enabled inline and subprocess runs with retained records and artifact references
    When their completed scratch is removed after persistence
    Then existing inspection surfaces read the same redacted records and referenced artifacts from durable storage
    And run identity, append order, no-log behavior and legacy record classification are preserved

  @core
  # covers: I1, I3, I4
  Scenario: R4 — Session history and exported results remain available outside scratch
    Given agent sessions, a planning handoff and worktree results needed by later consumers
    When their durable persistence and history import obligations are satisfied before scratch disposal
    Then later history reads and worktree result consumers retain their data
    And active or paused runs remain recoverable without premature disposal

  @core
  # covers: I2, I3, I4, I5
  Scenario: R5 — Temporary handoffs retain freshness and confinement safeguards
    Given a previous attempt answer, escalation question or PASS marker and an unrelated active run
    When a new attempt executes or required local invalidation is reviewed
    Then old artifacts cannot satisfy the new attempt
    And atomic publication, symlink confinement and unrelated active run ownership are preserved
    And redundant cleanup is removed only after equivalent correctness is demonstrated

  @core
  # covers: I1, I3, I4
  Scenario: R6 — Existing lasting data is preserved before its scratch dependency is retired
    Given valid legacy evidence and run records alongside active, paused, malformed and conflicting candidates
    When the migration classifies and persists the valid lasting data
    Then migrated records keep their identity and content and repeating migration is harmless
    And unresolved candidates are reported and preserved without fabricated evidence
    And a persistence failure prevents successful disposal of the affected scratch

  @core
  # covers: I1, I2, I3, I4, I5
  Scenario: R7 — Completed scratch is disposable without per-workflow cleanup machinery
    Given isolated completed runs whose lasting data and consumer obligations are settled
    When regression tests remove completed scratch twice and execute a subsequent command
    Then acceptance, analytics and retained inspection remain unchanged and absent scratch is recreated as needed
    And command, workflow, unit-test and installed plugin contracts agree on temporary-only run storage
    And no per-workflow terminal cleanup step or new public CLI surface is required
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1024 | Audit run storage ownership and one-off cleanup | todo |
| 1025 | Persist task and feature evidence outside run scratch | todo |
| 1026 | Retain run records sessions and artifacts outside scratch | todo |
| 1027 | Verify disposable scratch and reconcile cleanup safeguards | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
