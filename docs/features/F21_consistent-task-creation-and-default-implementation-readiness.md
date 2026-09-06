---
schema_version: 1
id: "F21"
name: "Consistent task creation and default implementation readiness"
status: backlog
priority: P1
tags: []
created_at: "2026-09-06T19:44:10.927Z"
updated_at: "2026-09-06T21:01:19.759Z"
---

# F21: Consistent task creation and default implementation readiness

## Goal
Create tasks whose validation results match their declared preparation state, and make implementation-ready preparation the default CLI experience without another manual refinement action.
## Scope
In scope: shared single/batch task rendering and validation, complete matrix diagnostics, exact text serialization, structured create failures, default ready preparation with --skip-ready, bounded identity-preserving recovery, and planning/handoff integration. Cover CLI, shared application services, existing HTTP writer regression checks, canonical planning skill owners, seeded workflow call sites, and same-change documentation/tests.

Out of scope: task implementation during creation, new agent runtimes or dependencies, hidden model execution in HTTP create, speculative feature linking, weakening required-content or execution gates, corpus-wide automatic repair, and unrelated workflow fixes.

Delivery: two cohesive implementation tasks after the current workflow repair batch; serialization and diagnostic fixes stay with the shared writer/checker task, while single/batch ready orchestration and handoff stay together.
## Acceptance Criteria
```gherkin
Feature: Consistent task creation and default implementation readiness

  @core
  Scenario: R1 — Capture validation follows the actual section matrix
    Given a supported task variant and a bare capture with a valid background
    When creation and current-status checking run with the same project or bundled matrix
    Then optional unfilled planning sections do not cause scaffold-only errors or warnings
    And the task remains backlog and requiredSections lists every resolved required section even when all are present

  @core
  Scenario: R2 — Supplied task specifications are validated before persistence
    Given a single or batch candidate with supplied planning content
    When the shared creation path evaluates the candidate for its intended status
    Then malformed authored content and missing required content are reported before commit
    And a complete valid specification can enter todo while incomplete capture cannot claim implementation readiness

  @core
  Scenario: R3 — Task input round trips and failures preserve machine output
    Given task names or tags containing quotes backslashes colons Unicode or allowed line breaks
    When single or batch creation runs with raw JSON or envelope output
    Then successful show output preserves the original strings exactly
    And invalid input exits nonzero with one parseable error result and no created files

  @core
  Scenario: R4 — Default creation prepares a task and skip-ready captures intent
    Given sufficient project context and an available configured planner
    When spur task create completes without skip-ready
    Then the existing ready-refinement checklist and deterministic post-check both pass before ready success is returned
    And skip-ready invokes no model and leaves a title-only capture at backlog without implementation evidence

  @core
  Scenario: R5 — Preparation failure preserves task identity and a recovery action
    Given a task was saved before its ready preparation failed timed out or was interrupted
    When creation reports the failed preparation
    Then it exits nonzero with the existing WBS path failure stage and exact refinement recovery command
    And it preserves authored content and never silently recreates the task or reports readiness

  @core
  Scenario: R6 — Batch preparation validates all candidates before commit
    Given a batch requiring ready preparation or a host-authored complete batch with skip-ready
    When the batch creation boundary runs
    Then the default path prepares the whole batch once before committing and rejected items cause no task or parent mutations
    And the host-prepared path performs no second model pass and reports preparation as skipped rather than inventing an agent verdict

  @core
  Scenario: R7 — Planning handoff distinguishes specification readiness from execution eligibility
    Given a created batch with run-scoped ready-checklist evidence and declared task dependencies
    When planning finalizes the handoff
    Then it recommends execution only with current successful specification evidence and valid task checks
    And missing stale or failed readiness evidence yields a precise preparation action while unfinished dependencies remain visible to execution gates

  @core
  Scenario: R8 — Shared HTTP and internal task writers remain deterministic
    Given an HTTP or internal caller uses the shared task write service
    When it creates or validates task content
    Then the same deterministic content and serialization rules apply without launching an agent
    And CLI orchestration and host planning reuse existing agent facilities and the canonical ready competency outside file locks
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0787 | Make task creation and checking agree on valid persisted content | todo |
| 0788 | Deliver ready-by-default task creation across CLI and planning | todo |
<!-- END AUTO-GENERATED -->

## Notes
Delivery is scheduled after the D6 workflow repair batch ending at 0786. Two tasks only: 0787 fixes deterministic creation/check correctness including serialization and machine errors; 0788 delivers ready-by-default creation across CLI, batch and planning handoff. Tests, documentation and recovery stay in the owning task.

Approved design: docs/design/task-creation-readiness.md; decision ADR-109. The operator approved the direction and design gate on 2026-09-06 and explicitly asked to avoid overly small tasks. This feature is planned, not implemented.
## History
