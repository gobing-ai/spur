---
schema_version: 1
name: "Close remaining proof-input and physical artifact confinement gaps"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.398Z
updated_at: "2026-09-06T18:27:45.399Z"
feature_id: D6
priority: P1
---

## 0785. Close remaining proof-input and physical artifact confinement gaps

### Background

Audit 0781 F-07: proof.fingerprint readOptional silently omits a supplied missing task/feature path, and probes relative paths against ambient cwd rather than context.workdir. Optional omission and declared-but-unreadable input are conflated. run.artifact validates only the existence of a well-formed digest in vars, not correspondence to the artifact. The 0781 lexical prefix repair does not prevent symlink escapes. Dormant fast routing also stamps review completed despite skipping review; it must stay inactive.

### Requirements

- [ ] R1. Distinguish absent optional spec inputs from explicitly supplied missing/unreadable paths; resolve supplied paths against context.workdir and fail before producing proof when unavailable. Trace all proof callers and preserve task/feature inclusion obligations.
- [ ] R2. Enforce physical artifact confinement against existing leaf or ancestor symlinks before action side effects using existing filesystem seams; reject escapes while preserving legitimate descendants and explicit fake-filesystem tests.
- [ ] R3. Make current proof binding verify the declared artifact correspondence, not merely a digest-shaped run var; missing/mismatched bindings cannot certify PASS. Record only stages actually executed; never stamp skipped review as completed. Keep fast activation blocked under ADR-107.

### Acceptance Criteria

```gherkin
Feature: Fail-closed proof and artifact inputs
  Scenario: R1 — Declared missing proof inputs fail closed
    Given an explicitly supplied missing task spec or a workdir-relative spec
    When proof capture executes
    Then the missing spec fails without a digest
    And the relative spec is read under the workflow workdir
  Scenario: R2 — Artifacts cannot escape through symlinks or claim false binding
    Given an artifact path escaping through a symlink or carrying mismatched proof
    When the action tries to write or record it
    Then it fails before the external write or ledger record
    And unexecuted review is never reported completed
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Own proof-fingerprint.ts, proof-input-fingerprint.ts, run-artifact.ts, command-gate.ts and directly affected proof callers/tests. Reuse runtime filesystem and current verdict/proof schema; do not add a sandbox platform or generalized policy DSL. Boundary tests must assert no command/write/ledger side effects. Clarify whether non-verdict artifact kinds can request current binding using existing ADR-071 contract; surface unresolved policy rather than invent it. Sync owning docs. Never weaken proof or enable fast routing to make tests green.

### Plan

- [ ] Add missing-path, workdir, symlink and mismatched-artifact reproductions.
- [ ] Repair shared input/binding boundaries and accurate stage provenance.
- [ ] Verify all affected pipelines and existing safety-path regressions.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
