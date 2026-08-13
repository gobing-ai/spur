---
template: feature-impl
schema_version: 1
name: "Load workflow YAML extensions on validate and run"
description: ""
status: todo
type: task
profile: standard
feature_id: D4
parent_wbs: null
priority: P1
tags: ["workflow", "extensions"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T06:19:08.017Z"
updated_at: "2026-08-13T06:19:08.020Z"
---

## 0533. Load workflow YAML extensions on validate and run

### Background

`loadWorkflowExtensionsIntoHost` exists in `@gobing-ai/ts-dual-workflow-engine` but `WorkflowAppService.createEngineService` never calls it. `spur workflow run` therefore cannot use kinds listed only in YAML. Rule presets already declare `extensions.evaluators: [./file.ts]` and load them. After ts-libs C1 adds `extensions.actions` / `extensions.guards` to WorkflowDef, this task is the CLI consumer.

Implements: A listed action module is registered for the same file; A listed guard module is registered for the same file; validate and run fail closed on a bad extension; dry-run and continue use the same loaded host; Absolute and parent-traversal paths are rejected; Surface docs land with the code.

Depends on: ts-libs feature C1 (engine schema + collectWorkflowExtensions). Bump the catalog after C1 ships.

Rubric: E1 D1 L1 C1 R1 = 5 → one task (same host-build file surface).

### Requirements

- [ ] R1. After loadWorkflowDef, collect extensions.actions / extensions.guards with baseDir = dirname(workflow file) and register them via loadWorkflowExtensionsIntoHost.
- [ ] R2. validate, run (including --dry-run), and continue share that load path.
- [ ] R3. When the YAML lists any extension, allowExtensions is true; a missing or invalid module fails the command before any step.
- [ ] R4. Absolute paths and `..` are rejected with no import.
- [ ] R5. The embedded $schema map and apps/cli/schemas copies include the new field (0431 parity).
- [ ] R6. docs/04_DESIGN.md and the workflow extension skill reference document the block in the same commit (T3).

### Acceptance Criteria

```gherkin
Feature: Load workflow YAML extensions on validate and run

  Scenario: R1 — A listed action module is registered for the same file
    Given a workflow YAML lists extensions.actions: ["./exts/audit.ts"]
    And that module default-exports an action kind audit-log
    When spur workflow run executes a step with kind audit-log
    Then the host runs the extension action

  Scenario: R2 — A listed guard module is registered for the same file
    Given a workflow YAML lists extensions.guards: ["./exts/flag.ts"]
    And that module default-exports a guard kind feature-flag
    When a transition guard has kind feature-flag
    Then the host evaluates the extension guard

  Scenario: R3 — validate and run fail closed on a bad extension
    Given extensions.actions names a missing file or a module without actions[]
    When spur workflow validate or run is invoked
    Then the command fails before any workflow step

  Scenario: R4 — dry-run and continue use the same loaded host
    Given a workflow with a custom guard listed under extensions.guards
    When spur workflow run --dry-run or spur workflow continue runs
    Then the extension guard is registered and evaluated

  Scenario: R5 — Absolute and parent-traversal paths are rejected
    Given an extensions entry that is absolute or contains ..
    When validate or run is invoked
    Then the command fails and no import is attempted

  Scenario: R6 — Surface docs land with the code
    Given the implementing commit
    When 04_DESIGN.md and the workflow extension skill reference are read
    Then they document extensions.actions and extensions.guards
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: in createEngineService / the post-load path used by validate and run, call collectWorkflowExtensions then loadWorkflowExtensionsIntoHost with moduleLoader = import and node realPath. Trust: a project workflow YAML already runs shell; listing a relative module next to that file is the same trust class. The YAML declaration is the allowExtensions signal.

Rejected: --allow-extensions flag (extra surface; declaration is the gate); loading from ~/.spur or absolute paths; registering kk product plugins as builtins.

Invariants: same host for dry-run and continue; fail before first step; 0431 validate/run schema map stays aligned.

### Plan

1. Bump @gobing-ai/ts-dual-workflow-engine once ts-libs C1 is published/catalogued.
2. Add load-extensions helper used by validate, run, and continue.
3. Tests: temp YAML + temp extension module; happy path action/guard; missing module; abs/`..`; dry-run.
4. Refresh bundled schemas + 04 + skill reference.
5. bun test / lint green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

D4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
