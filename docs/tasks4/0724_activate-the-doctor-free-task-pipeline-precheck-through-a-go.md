---
schema_version: 1
name: "Activate the doctor-free task-pipeline precheck through a governed release"
status: todo
template: feature-impl
created_at: 2026-08-30T23:52:55.880Z
updated_at: "2026-08-30T23:53:45.391Z"
feature_id: D6
dependencies: ["0723"]
ac_numbering: task-local
ac_altitude: task-local
---

## 0724. Activate the doctor-free task-pipeline precheck through a governed release

### Background
Task 0723 made the task-pipeline precheck deterministic and doctor-free in source, and proved it
from the working tree: workflow validate exit 0, targeted suites green, full repository gate
6952 pass / 0 fail. Its original R5 also carried the activation half — rebuild the bundled CLI,
release and reinstall Spur plus plugin `sp` through the governed surfaces, and confirm from a fresh
coding-agent session that a canary precheck emits no doctor action.

That half is a release activity, not implementation, and the operator deferred the build/release
(2026-08-30: server runs from source until a later release). Verification of 0723 therefore held at
PARTIAL on R5 alone. Per the operator's scope decision on 2026-08-30, the activation half is split
here so 0723 can close on its source-local proof while the release work stays tracked rather than
lost.

Prerequisite: 0723's change set committed. Evidence baseline: before-trace
`inline-20260821-083900-0614` (1.702 s in doctor.probe plus 268 ms size precheck).
### Requirements
- [ ] **R1.** Rebuild and release the bundled Spur CLI carrying the doctor-free task-pipeline
      precheck shipped by task 0723, through the governed release surface only — no hand-edited
      bundle, no direct publish that bypasses the repo's release entrypoints.
- [ ] **R2.** Reinstall Spur and plugin `sp` through Superskill's install surface, then record
      binary and plugin artifact provenance (version, path, build timestamp) proving the installed
      artifacts carry the new precheck rather than a stale bundle.
- [ ] **R3.** Verify from a fresh coding-agent session that a canary task-pipeline precheck emits no
      `doctor.probe` action and spawns no `spur agent doctor` subprocess, and that the canary reaches
      implementation with no precheck regression against the recorded before-trace.
### Acceptance Criteria
```gherkin
Feature: Governed activation of the doctor-free task-pipeline precheck

  @core
  Scenario: R1 — The released bundle carries the doctor-free precheck
    Given task 0723's precheck changes are committed on the default branch
    When the bundled CLI is rebuilt and released through the governed release entrypoints
    Then the released bundle contains no `doctor.probe` action in task-pipeline precheck
    And no step hand-edits the bundle or bypasses the repo release entrypoints

  @core
  Scenario: R2 — Installed artifacts prove their provenance
    Given the released Spur build and plugin sp
    When both are reinstalled through the Superskill install surface
    Then the recorded version, path, and build timestamp identify the new build
    And the installed bundle does not contain the pre-0723 precheck

  @core
  Scenario: R3 — A fresh-session canary reaches implementation doctor-free
    Given the reinstalled Spur and plugin sp
    When a new coding-agent session runs a minimal canary task through task-pipeline precheck
    Then the run contains no doctor action and no `spur agent doctor` subprocess
    And the canary reaches implementation with no precheck regression against the before-trace
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
