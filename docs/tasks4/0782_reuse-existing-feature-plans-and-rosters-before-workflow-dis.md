---
schema_version: 1
name: "Reuse existing feature plans and rosters before workflow dispatch"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.282Z
updated_at: "2026-09-06T19:03:55.166Z"
feature_id: D6
priority: P1
---

## 0782. Reuse existing feature plans and rosters before workflow dispatch

### Background
Audit 0781 F-03, rechecked against feature-dev.yaml: precheck only tests nonempty featureId and runs agent doctor; every success enters brainstorm then plan; feature-verify executes the same strict command in two guards. Task 0770 Design and D6 scenarios R10/R11 require reuse and one completion decision. Five current D6 pending tasks already have accepted task identities; rerunning feature creation/decomposition would duplicate work. This is a task-local correction to an existing-feature consumer, not a new planning mode.
### Requirements
- [ ] R1. Before any model dispatch, resolve the supplied feature and its linked task roster through existing CLI reads and validate the feature's essential structural contract. Reject missing identity, malformed/non-array roster, duplicate/mismatched identities, an empty roster, and any backlog/wip/testing/blocked task with an actionable handoff; do not auto-create or replan.
- [ ] R2. Reuse accepted AC and the resolved roster. Dispatch the explicit frozen todo WBS list to the existing runall operation; ignore done/cancelled members. A nonempty all-terminal roster goes straight to completion verification with zero model calls for execution. Preserve profile-controlled auto versus interactive task execution.
- [ ] R3. Execute feature check --as done --json exactly once at feature-verify, capture its exit and JSON result, and let sibling guards read that decision. Missing/malformed/non-PASS evidence fails before integration review. Do not add --strict warning elevation or a whole-corpus scan.
- [ ] R4. Preserve the existing collected-HEAD review policy and phase boundary. No new planning flag or implicit brainstorm/decomposition; explicit planning remains /sp:dev-plan or /sp:dev-idea outside this consumer.
### Acceptance Criteria
Ready-depth verification cases supplement the stable feature-mapped titles below; keep their identities unchanged.

```gherkin
Feature: Existing feature workflow reuse
  Scenario: R1 — Existing feature work avoids duplicate planning
    Given a valid feature with accepted AC and an existing task roster
    When feature-dev starts
    Then the existing roster is reused without brainstorm or decomposition
    And invalid feature input fails before model dispatch
    And only frozen todo task IDs reach runall with the requested profile
    And a nonempty all-terminal roster reaches verification without an execution model hop
  Scenario: R2 — Feature verification runs once
    Given a completed feature batch
    When the essential feature completion check fails
    Then one check invocation is recorded and the workflow fails without requesting review
    And malformed or missing check evidence also fails
    And advisory warnings alone do not fail a valid completion
```

Verify in packages/app with bun test tests/workflow/feature-dev-definition.test.ts. Extend the fixtures to count actual CLI calls and model dispatches; use stub agents/review commands, never a GitHub request.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T19:03:54.787Z

- Existing feature with no tasks or unready work: refuse with a planning/refine/resume handoff; no implicit planning or new flag.
- All linked tasks done/cancelled: verify directly; do not invoke an empty runall batch.
- Roster changes during execution: the child executes the frozen IDs; the final live feature completion check detects newly pending/missing coverage.
- Priority is reducing duplicated model planning, not weakening completion or PR-review policy. No open design decision remains.
### Design
#### Frozen design
Choose an existing-feature-only graph over conditional replanning: delete brainstorm/plan states and their edges, because the caller already supplies featureId and accepted planning belongs to the separate planning entrypoint. Do not add a planner service or route flag.

Keep precheck, execute-tasks-auto, execute-tasks, feature-verify, integration-review, done and failed. Replace the duplicate doctor with essential feature/roster validation; task execution owns executor availability. Capture feature show and task list --feature results once under .spur/run/<runId>-feature-dev-{feature,roster}.json. Use quoted shell variables, reject empty __runId, and validate JSON identity/status fields rather than grepping content. A feature check at entry is structural; the later --as done check is a different post-mutation obligation.

Internal artifact/var names are frozen: .spur/run/<runId>-feature-dev-tasks.txt contains the sorted comma-separated todo WBS list; declare featureTaskIds with an empty default. Reuse file.read.into-var (path/var/trim) on the execution branch, then pure-slash /sp:dev-runall --tasks ${vars.featureTaskIds}, adding --auto only in execute-tasks-auto. No shell substitution inside prompts. Do not re-enumerate membership inside the child selector.

Keep the existing precheck status path. At feature-verify, capture one command result in .spur/run/<runId>-feature-dev-verify.json plus a .status sibling; success requires exit 0, a nonempty result array, and every returned pass === true. Guards only read PASS; use a final failure fallback. Required file/write failures must fail the action or the workflow, never leave a stale PASS. Refuse roster statuses requiring refinement/resumption rather than launching overlapping work.

Increment this definition's quoted version when behavior changes. Own config/workflows/feature-dev.yaml, packages/app/tests/workflow/feature-dev-definition.test.ts, and relevant docs/04_DESIGN.md/essential-workflow-checks.md surface notes. Existing file.read.into-var is already implemented in packages/app/src/workflow/actions/file-read-into-var.ts; no new action or API.

Handoff: 0784 runs after 0782 and removes the obsolete terminal checkpoint writer without restoring planning states. Integration review request/collect and requireCleanReview remain unchanged. No new public noun/verb, dependency, engine, registry, cache, baseline, blanket strictness, fast-route activation, live-run mutation, external review request, host installation, or release. Workflow/source changes below are the implementation handoff, not actions performed by refine.

Execution budget: one owned task at a time; checkpoint after 45 minutes or two unsuccessful fix iterations in .spur/run/0782-execution-notes.md, preserving focused logs. Reproduce with targeted workspace tests before the single final project gate. requireDiff: source/tests for runtime tasks, canonical docs/tests for 0786; no fabricated source edit for refinement. Refinement itself changes planning sections only.
### Plan
- [ ] R1/R2: add failing source-definition fixtures for missing/invalid feature, malformed/duplicate roster, unready status, all-terminal roster and exact todo dispatch count.
- [ ] R1/R2: replace the planning prefix with captured existing-feature validation and profile-aware explicit-task runall dispatch; reuse file.read.into-var.
- [ ] R3: move one essential completion check into feature-verify onEnter and make guards consume its result; test nonzero, malformed, missing, warning-only and PASS cases.
- [ ] R4: retain collected-HEAD review behavior; update version and owning surface notes.
- [ ] Run focused definition/CLI workflow tests, bundle parity and the final project gate during implementation; record actual counts, not estimated token savings.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-03.
- docs/00_ADR.md — ADR-022, ADR-043, ADR-107 Option B, ADR-108.
- docs/design/essential-workflow-checks.md — Completion integrity and existing-feature execution.
- config/workflows/feature-dev.yaml; packages/app/src/workflow/actions/file-read-into-var.ts.
- Task 0770 (delivered obligation); task 0784 (downstream checkpoint cleanup).
### History
