---
schema_version: 1
name: Complete PR-9 release and workflow-cost CLI absorption
status: todo
template: standard
created_at: 2026-10-15T17:50:40.221Z
updated_at: "2026-10-15T17:51:06.730Z"
ac_altitude: task-local
ac_numbering: task-local
parent_wbs: "1211"
priority: P1
tags:
  - script-absorption
  - pr9
estimate_hours: 6

feature_id: A91
---

## 1212. Complete PR-9 release and workflow-cost CLI absorption

### Background

Implements task 1211 R1 / AC1 — PR-9 is complete and green. Draft PR #26 (feat/builder-publish-cost-migrate-absorb) already carries workflow cost, builder publish, builder bump-ver --check and self migrate --check, based on PR #24. Continue its existing implementation against the accepted integration baseline; preserve its branch history with a chore: merge commit and no rebase. CI evidence https://github.com/gobing-ai/spur/actions/runs/38776447947 reports 11026 passing, 26 preexisting skips, four contract failures; coverage has not been independently certified. Owner: this task exclusively owns draft #26 completion, its CLI/application code, migrated tests, release workflow caller and matching help/reference contracts. Parent 1211 remains the cross-repo reviewer and landing owner.

### Requirements

- [ ] R1. Finish the existing workflow cost [--budget], builder publish, builder bump-ver --check and self migrate --check paths without expanding public surfaces or running a real publish during verification.
- [ ] R2. Resolve the four observed CI contract failures: apps/cli/tests/help-doc-parity.test.ts AC7 undocumented workflow cost flags; shared-option-parity test literal workflow.ts --json assertion; plugins/sp/tests/cli-surface-parity workflow reference mismatch; plugins/sp/tests/help-docs-parity R2 missing workflow cost docs. Fix actual docs/registration drift and make moved-source assertions inspect their current owning modules; retain meaningful assertions.
- [ ] R3. Remove live references to retired scripts/commands/{publish,real-run-cost,pipeline-budgets,importer-schema-check,check-marketplace-version}.ts and their obsolete tests. Keep project-specific workflow promotion policy repository-owned while requesting measurement through spur workflow cost --json.
- [ ] R4. Synchronize CLI registration, docs/help, docs/help2, spur-cli references, CLI matrix counts, config rules, package scripts and the existing publish.yml caller. Do not edit either bunfig.toml or add spur-check-feature to gate/CI.
- [ ] R5. Produce successful parity, targeted and full gate receipts; prove at least 90% line AND function coverage per new/touched measured executable file, especially run-cost.ts, release-ops.ts and migrate/cost adapters, without lowering thresholds or introducing skips. Mark #26 ready and record exact tested head/log and remaining preexisting skips.

### Acceptance Criteria

```gherkin
Scenario: AC1 — PR-9 is complete and green (req: R1, R2, R3, R4, R5)
Given draft PR #26 incorporates the accepted integration baseline
When its documented CLI commands and golden parity tests run using temporary data and mocked publishing
Then all four known contract failures are resolved without weakening the contracts
And retired script paths have no live callers, workflow promotion uses workflow cost --json, and release callers use builder publish/bump-ver --check
And docs/help, help2, spur-cli references and CLI matrix match registered flags and commands
And the full required gate succeeds with at least 90% line and function coverage per measured changed executable file
And the ready PR records the exact tested head, gate receipt and coverage evidence
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Continue the existing #26 delta after incorporating the accepted PR #24/integration baseline; preserve migrated behavior and structured CLI output. Logic stays application-owned where already designed, transport/release plumbing stays in its existing CLI owner. Ownership includes apps/cli/src/commands/{builder,migrate,workflow/cost}.ts, apps/cli/src/release-ops.ts, packages/app/src/workflow/run-cost.ts, related tests, scripts/spur-dev.ts, workflow-promotion caller, existing publish.yml edit and matching docs/config. Reject splitting docs, tests, publish and cost into separate tasks: they jointly define the one already-open PR and its acceptance proof. Do not execute publishing, push tags or mutate real project data in tests; use existing process seams and temporary repositories.

### Plan

1. Read the current #26 diff and CI log; merge the accepted integration baseline with a conventional chore: merge commit.
2. Fix the four known contract failures, audit remaining migrated callers and test significant release/migration error paths.
3. Synchronize all help/reference/matrix surfaces and refresh parity evidence from the recorded legacy baseline.
4. Run focused workspace tests and the serialized required gate; preserve user configuration and record per-file coverage plus exact tested head.
5. Submit the complete #26 diff to parent reviewer, update its body and mark ready; parent owns acceptance and landing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
