---
schema_version: 1
name: "Make wrapup consume validated inputs and fail on incomplete synchronization"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.332Z
updated_at: "2026-09-06T18:27:45.333Z"
feature_id: D6
priority: P1
---

## 0783. Make wrapup consume validated inputs and fail on incomplete synchronization

### Background

Audit 0781 F-04: config/workflows/wrapup-pipeline.yaml contradicts task 0770 Design. Raw tasks are parsed in the reason action and guards despite normalized capture; whitespace-only WBS yields PASS with no lookup; metrics can PASS on missing/malformed normalized input; sync treats any applied:false as a successful no-change even when proposal.gateBlocked or requiresConfirm leaves from!=to. Reproduction of task-resolve with tasks=[" "] and spurBin=false exits 0 and writes PASS.

### Requirements

- [ ] R1. Validate one task array, reject whitespace/invalid IDs, resolve every member with exit and JSON-shape checks, and deduplicate. Every route/model prompt/metrics consumer uses the same normalized run-scoped input; missing or corrupted captures fail, only validated [] skips.
- [ ] R2. Metrics append valid JSON for each member only after successful lookup; missing/invalid source or append failures cannot write PASS.
- [ ] R3. Required sync succeeds only on a reached target or genuine from==to no-op; blocked, confirmation-required, malformed, and partial outcomes fail explicitly while preserving existing evidence.
- [ ] R4. Remove redundant raw parsing, fallback run IDs and contradictory soft-success comments; retain one doc-sync model hop and consent-only branch operations.

### Acceptance Criteria

```gherkin
Feature: Truthful wrapup outcomes
  Scenario: R1 — Invalid wrap input never succeeds
    Given whitespace-only task IDs or missing or malformed normalized input
    When wrapup resolves or records metrics
    Then it fails rather than skipping work or writing PASS
  Scenario: R2 — Blocked synchronization is not no-change success
    Given a required feature sync with applied false and an unreached target
    When wrapup handles the result
    Then it reports failure and preserves prior artifacts
    And an actual from-equals-to no-op remains successful
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Own config/workflows/wrapup-pipeline.yaml and packages/app/tests/workflow/wrapup-pipeline.test.ts; inspect plugins/sp/scripts/feature-sync-bounded.ts result contract first. Prefer existing CLI/jq capture owners, proper iteration and JSON serialization; delete repeated parses. No broad corpus sweeps or new state engine. Test extracted shell plus actual transition selection, including run-ID isolation, duplicate inputs, malformed successful stdout and write failures. No remote calls. Sync docs/04_DESIGN.md.

### Plan

- [ ] Reproduce false-success branches with actual shell fixtures.
- [ ] Use normalized input everywhere; validate sync target and metrics outcomes.
- [ ] Verify failure paths and unchanged successful wrap, then final gate.

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
