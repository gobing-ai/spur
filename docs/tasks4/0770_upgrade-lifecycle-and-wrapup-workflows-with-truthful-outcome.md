---
schema_version: 1
name: "Upgrade lifecycle and wrapup workflows with truthful outcomes"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.947Z
updated_at: "2026-09-05T15:39:37.090Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P6"]
dependencies: ["0775", "0767", "0768"]
---

## 0770. Upgrade lifecycle and wrapup workflows with truthful outcomes

### Background

D61 implementation package P6, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Own task-lifecycle.yaml, feature-lifecycle.yaml, feature-dev.yaml and wrapup-pipeline.yaml. Lifecycle transitions are externally requested, so duplicate source/target edges are unsafe. feature-dev currently treats successful review request as PASS even with requireCleanReview=true. Wrapup currently treats parse failure as empty, shares wrapup-learnings.md and reports synchronization errors while exiting successfully. Its branch-cleanup state records consent but performs no git cleanup.

Dependencies: 0775, 0767, 0768 (0775 retires the corpus/composition baselines and the regenerator-only machinery as the third phase of decomposed 0766 R2). Detailed inputs and handoffs are frozen below.

### Requirements

- [ ] **R1.** Lifecycle and wrapup outcomes remain authoritative: preserve single-edge lifecycle transitions and normal target completion guards; reuse an existing feature/task roster; require a collected current-HEAD CLEAN result when requireCleanReview=true; reject malformed wrap input, isolate captures and report failed required sync as failure. Tag all four definitions version: "1" after their behavior checks.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Upgrade lifecycle and wrapup workflows with truthful outcomes

  @core
  Scenario: R1 — Lifecycle and wrapup outcomes remain authoritative
    Given the upgraded task-lifecycle, feature-lifecycle, feature-dev, and wrapup-pipeline definitions
    When transitions, existing-feature execution, and wrapup are exercised
    Then each externally driven transition has one edge per source and target pair
    And incomplete or unverified work cannot become done
    And invalid wrapup input or failed required synchronization is not reported as success
    And requesting an integration review is not treated as a collected clean review

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:41.148Z

Closed: strict integration review uses one existing head-pinned collect, no polling addition; pending is a visible strict failure and an advisory pending result. Wrapup failure preserves already-written artifacts. Branch cleanup performs no new git action.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new API, nested PR workflow or replanning service. Consume 0765 checks and 0766 affected-feature audit default, 0767 live inventory and 0768 metadata/progress. Keep requestTransition adapters and existing feature-sync-bounded/pr-reviewing script owners. 0771 owns pr-review.yaml, so avoid modifying that definition here.

Lifecycle: one transition edge per from/to pair, not sibling fast/safety guards. Every testing/done check uses --as target with 0765 semantics. Preserve reopen/cancel/active-goal behavior and task done provenance; no --no-lifecycle bypass of actual done guard. mode remains empty by default; keep D9 reason reporting and safety path.

Feature-dev: obtain feature and linked task roster through feature/task CLI; use the existing feature/AC when supplied rather than run intake/decomposition again. Missing/invalid ID or roster is failure. Keep one request per HEAD through plugins/sp/scripts/pr-reviewing.ts request. Capture its JSON head in a run-scoped artifact; then invoke the existing collect --head <captured-head> --json --status-file <run-scoped-path> once. No new wait loop or external publishing during tests. The script's collected verdict is CLEAN, FINDINGS or PENDING; command failure/head drift/invalid JSON is FAIL. REQUESTED/ALREADY_REQUESTED/ALREADY_REVIEWED only describe request state, never clean evidence. With requireCleanReview=true, only collected CLEAN permits done; all other outcomes reach failed with the actual pending/findings/error reason. Advisory default false may finish after local verification, but its summary preserves the collected non-clean state. No requirement for all advisory reviews to finish synchronously.

Wrapup: parse vars.tasks once at task-resolve as a JSON array of non-empty WBS strings, resolve every member with task show and require completed status (done/cancelled); reject malformed JSON, non-array, non-string entries or unresolved/open task. Deduplicate repeated IDs in first-seen order. [] alone reaches skipped. Persist normalized current-run input and route result; sibling guards and metrics consume them, never parse invalid input as zero. Add failed to terminalStates and failureStates for invalid input/required operation failure; keep skipped distinct. Do not mutate task statuses.

Use .spur/run/<runId>-wrapup-learnings.md consistently in agent prompt, answerFile, expectFile and append reader. Require a non-empty runId rather than a shared fallback. Doc-sync failure/empty required capture fails; metrics/feature lookup failure is visible, never silently omitted as success. Keep already written learnings/metrics on later failure; no rollback mechanism. Feature sync uses existing bounded helper/fallback, captures exit and result, then affected feature check from 0766 after applied or partially failed sync. A nonzero required sync/check or invalid result reaches failed, including a sync that cannot reach its declared target; a successful no-change result is explicitly no-change. No whole corpus sweep. Branch cleanup remains consent-only; summary says requested/skipped, never claims branch cleaned. Do not add git merge/delete behavior.

Set each version only after its tests pass. Output: four verified definitions and truthful outcome fixtures for 0772. Sync docs/04_DESIGN.md and canonical execution/wrap guidance; preserve explicit consent rules already applicable to irreversible operations.

Verification targets: From packages/app: bun test tests/workflow/lifecycle-adapter.test.ts tests/workflow/feature-lifecycle-adapter.test.ts tests/workflow/feature-dev-definition.test.ts tests/workflow/proportional-routing-pilots.test.ts. Add tests/workflow/wrapup-pipeline.test.ts for malformed-vs-empty, resolution failure, repeated-run isolation and required sync failure. Extend plugins/sp/tests/pr-reviewing.test.ts only if its shared script contract changes. Mock command runner/GitHub; never send review requests in verification fixtures.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

### Plan

1. [ ] R1: Capture pre-change fixture digests/counts for 0772 and preserve normal lifecycle positive/negative fixtures from 0765.

2. [ ] R1: Refine task/feature lifecycle guards and reason reporting without duplicate source/target edges; test actual requestTransition, reopen and cancel.

3. [ ] R1: Implement feature roster reuse and request-plus-collect result routing; table-test strict CLEAN/PENDING/FINDINGS/FAIL/head drift and advisory behavior with external calls mocked.

4. [ ] R1: Validate wrap input once, isolate learning captures, and route required doc/metrics/sync/check failures to failed; keep [] skipped and task statuses untouched.

5. [ ] R1: Test consecutive runs, invalid input, partial sync failure and branch-cleanup consent-only reporting; tag and validate the four final definitions.

6. [ ] R1: Update live docs/skills, run applicable final gate and real verification; hand outcomes and matched measurements to 0772.

### Solution
<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (decomposition, 2026-09-05):** task 0770 is **blocked** on 0775 (third phase of decomposed 0766 R2), 0767 and 0768. The original batch halted at task 0766 (deferred); the per-fixture remediation plan decomposes 0766 into 0773/0774/0775, with 0775 being the predecessor this task now wires through. Once 0775/0767/0768 land, 0770 unblocks.

Anticipated change anchors (populated during implementation):

- `config/workflows/task-lifecycle.yaml:1` — single-edge transition guards.
- `config/workflows/feature-lifecycle.yaml:1` — single-edge transition guards.
- `config/workflows/feature-dev.yaml:1` — request-plus-collect CLEAN gating under requireCleanReview.
- `config/workflows/wrapup-pipeline.yaml:82` — featureGateCmd default updated by 0775.
- `config/templates/docs/99_PROJECT_CONSTITUTION.md:1` — T10/T11 applied by 0775.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0766 --json; spur task show 0767 --json; spur task show 0768 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
