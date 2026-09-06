---
schema_version: 1
name: "Reuse existing feature plans and rosters before workflow dispatch"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.282Z
updated_at: "2026-09-06T18:43:32.262Z"
feature_id: D6
priority: P1
---

## 0782. Reuse existing feature plans and rosters before workflow dispatch

### Background

Audit 0781 F-03: task 0770 Design requires feature-dev to consume an existing feature/AC and linked roster. config/workflows/feature-dev.yaml instead always calls brainstorm, plan, then runall. A supplied non-empty ID plus doctor is the only precheck; this repeats expensive planning and can create duplicate tasks.

### Requirements
- [ ] R1. Resolve the feature and linked task roster once before model dispatch; missing/invalid identity or roster fails explicitly.
- [ ] R2. Reuse existing accepted AC and planned tasks without rerunning brainstorm/decomposition; run only necessary pending work. Preserve explicit planning requests and approval boundaries.
- [ ] R3. Execute the essential feature completion check (--as done, without blanket --strict warning elevation) once and branch on its captured result; failures must not launch a second check or an external review. Preserve current collected-HEAD review policy.
### Acceptance Criteria
```gherkin
Feature: Existing feature workflow reuse
  Scenario: R1 — Existing feature work avoids duplicate planning
    Given a valid feature with accepted AC and an existing task roster
    When feature-dev starts
    Then the existing roster is reused without brainstorm or decomposition
    And invalid feature input fails before model dispatch
  Scenario: R2 — Feature verification runs once
    Given a completed feature batch
    When the essential feature completion check fails
    Then one check invocation is recorded and the workflow fails without requesting review
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Own config/workflows/feature-dev.yaml and packages/app/tests/workflow/feature-dev-definition.test.ts. Reuse feature/task CLI and existing script owners; no new public verbs, engines or planning service. Remove redundant calls rather than add a policy layer. Test actual shell and routes with a stub CLI and agents; no GitHub requests. Keep fast mode dormant. Sync docs/04_DESIGN.md and relevant canonical workflow guidance.

### Plan

- [ ] Add failing dispatch-count and missing-feature tests.
- [ ] Implement existing-plan routing and single captured verification.
- [ ] Verify normal and failure branches, authority sync, and final project gate.

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
