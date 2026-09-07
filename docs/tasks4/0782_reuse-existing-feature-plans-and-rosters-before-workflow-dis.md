---
schema_version: 1
name: "Reuse existing feature plans and rosters before workflow dispatch"
status: done
template: issue
created_at: 2026-09-06T18:27:45.282Z
updated_at: "2026-09-06T23:44:25.366Z"
feature_id: D6
priority: P1
---

## 0782. Reuse existing feature plans and rosters before workflow dispatch

### Background
Audit 0781 F-03, rechecked against feature-dev.yaml: precheck only tests nonempty featureId and runs agent doctor; every success enters brainstorm then plan; feature-verify executes the same strict command in two guards. Task 0770 Design and D6 scenarios R10/R11 require reuse and one completion decision. Five current D6 pending tasks already have accepted task identities; rerunning feature creation/decomposition would duplicate work. This is a task-local correction to an existing-feature consumer, not a new planning mode.
### Requirements
- [x] R1. Before any model dispatch, resolve the supplied feature and its linked task roster through existing CLI reads and validate the feature's essential structural contract. Reject missing identity, malformed/non-array roster, duplicate/mismatched identities, an empty roster, and any backlog/wip/testing/blocked task with an actionable handoff; do not auto-create or replan.
- [x] R2. Reuse accepted AC and the resolved roster. Dispatch the explicit frozen todo WBS list to the existing runall operation; ignore done/cancelled members. A nonempty all-terminal roster goes straight to completion verification with zero model calls for execution. Preserve profile-controlled auto versus interactive task execution.
- [x] R3. Execute feature check --as done --json exactly once at feature-verify, capture its exit and JSON result, and let sibling guards read that decision. Missing/malformed/non-PASS evidence fails before integration review. Do not add --strict warning elevation or a whole-corpus scan.
- [x] R4. Preserve the existing collected-HEAD review policy and phase boundary. No new planning flag or implicit brainstorm/decomposition; explicit planning remains /sp:dev-plan or /sp:dev-idea outside this consumer.
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
- [x] R1/R2: add failing source-definition fixtures for missing/invalid feature, malformed/duplicate roster, unready status, all-terminal roster and exact todo dispatch count.
- [x] R1/R2: replace the planning prefix with captured existing-feature validation and profile-aware explicit-task runall dispatch; reuse file.read.into-var.
- [x] R3: move one essential completion check into feature-verify onEnter and make guards consume its result; test nonzero, malformed, missing, warning-only and PASS cases.
- [x] R4: retain collected-HEAD review behavior; update version and owning surface notes.
- [x] Run focused definition/CLI workflow tests, bundle parity and the final project gate during implementation; record actual counts, not estimated token savings.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/workflow/feature-dev-definition.test.ts:12` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:133` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:2` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:31` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:5` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:59` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:117` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/feature-dev.yaml:82-131` — `precheck` onEnter resolves feature + roster through CLI JSON reads into `.spur/run/$__runId-feature-dev-{feature,roster}.json`, rejects missing identity, malformed/non-array roster, duplicate/mismatched identities, empty roster and any backlog/wip/testing/blocked member with an actionable planning/refine/resume handoff BEFORE model dispatch; nothing auto-created or re-planned. Re-read this run: the doctor call is gone and the state list is precheck/execute-tasks-auto/execute-tasks/feature-verify/integration-review/done/failed only. Test: `packages/app/tests/workflow/feature-dev-definition.test.ts` — 23 pass / 0 fail this run (dispatch + model-call counters stay zero on every rejection path). |
| R2 | MET | `config/workflows/feature-dev.yaml:132-167` — `execute-tasks-auto` (:137-145) and `execute-tasks` (:156-164) read the frozen sorted todo WBS list with `kind: file.read.into-var` into `featureTaskIds` (declared with an empty default at `:70`) and dispatch ONE pure-slash `/sp:dev-runall --tasks ${vars.featureTaskIds}` — `--auto` only on the auto branch, so profile-controlled auto-vs-interactive execution is preserved. Membership is never re-enumerated in the child selector; done/cancelled members never enter the list, so a nonempty all-terminal roster routes straight to feature-verify with zero execution model calls. Test: same suite, 23 pass / 0 fail this run. |
| R3 | MET | `config/workflows/feature-dev.yaml:169-193` — `feature-verify` onEnter runs `$spurBin feature check "$featureId" --as done --json` EXACTLY ONCE, captures exit code + JSON at `.spur/run/$__runId-feature-dev-verify.json`, and writes PASS/FAIL to the `.status` sibling via atomic tmp→`mv -f`; PASS requires exit 0 AND `type == "array" and length > 0 and all(.[]; .pass == true)`. Sibling guards read only the captured status — no guard re-runs the check. No `--strict` elevation and no whole-corpus scan appear in the block. Test: same suite, 23 pass / 0 fail this run (nonzero, malformed, missing and warning-only cases). |
| R4 | MET | `config/workflows/feature-dev.yaml:195-247` — `integration-review` keeps the 0770 collected-HEAD policy verbatim (one Codex review request per captured HEAD, then exactly one `pr-reviewing.ts collect --head <captured-head>`, no wait loop); phase boundary and `requireCleanReview` unchanged. No planning flag and no implicit brainstorm/decomposition state exists in the definition — explicit planning stays `/sp:dev-plan` / `/sp:dev-idea`. Definition `version:` at `:24` was incremented for the behavior change (now `"3"` after the later 0784 bump; 0782 shipped the 1→2 step). Docs same-change: `docs/04_DESIGN.md`, `docs/design/essential-workflow-checks.md`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Existing feature work avoids duplicate planning | MET | test | `config/workflows/feature-dev.yaml:82-167` — no `brainstorm` / `plan` state exists; precheck reuses the resolved roster and fails closed on invalid feature input before any model dispatch; only the frozen todo WBS list reaches `/sp:dev-runall` with the profile-selected branch; a nonempty all-terminal roster reaches feature-verify with no execution model hop. Executable evidence: `cd packages/app && bun test tests/workflow/feature-dev-definition.test.ts` → 23 pass / 0 fail, 115 expect() calls, this run. |
| Scenario: R2 — Feature verification runs once | MET | test | `config/workflows/feature-dev.yaml:169-193` — one `feature check --as done --json` invocation per run, captured to `.spur/run/<runId>-feature-dev-verify.json` with an atomic `.status` sibling; malformed or missing evidence writes FAIL so the workflow fails before requesting integration review; advisory warnings alone do not fail a valid completion (PASS keys off `all(.[]; .pass == true)`, not on warning counts). Executable evidence: same suite, 23 pass / 0 fail this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-03.
- docs/00_ADR.md — ADR-022, ADR-043, ADR-107 Option B, ADR-108.
- docs/design/essential-workflow-checks.md — Completion integrity and existing-feature execution.
- config/workflows/feature-dev.yaml; packages/app/src/workflow/actions/file-read-into-var.ts.
- Task 0770 (delivered obligation); task 0784 (downstream checkpoint cleanup).
### History
- 2026-09-06T19:36:57.828Z todo → wip (system)
- 2026-09-06T19:54:31.773Z wip → testing (system)
- 2026-09-06T19:54:32.981Z testing → done (system)
