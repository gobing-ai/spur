---
schema_version: 1
name: "Upgrade lifecycle and wrapup workflows with truthful outcomes"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:56.947Z
updated_at: "2026-09-06T15:48:49.461Z"
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

- [x] **R1.** Lifecycle and wrapup outcomes remain authoritative: preserve single-edge lifecycle transitions and normal target completion guards; reuse an existing feature/task roster; require a collected current-HEAD CLEAN result when requireCleanReview=true; reject malformed wrap input, isolate captures and report failed required sync as failure. Tag all four definitions version: "1" after their behavior checks.

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
**Truthful outcomes for lifecycle, feature-dev, and wrapup workflows (0770).**

Config definitions (all tagged `version: "1"` after tests passed):

- `config/workflows/wrapup-pipeline.yaml` — truthfulness upgrade: `terminalStates` += `failed`, `failureStates: [failed]`, `failed` state inserted after `skipped` (artifacts preserved, no rollback); task-resolve gains a SECOND shell that validates `vars.tasks` once as a JSON array of non-empty WBS strings (`r-bad` fixtures), fails loud on empty `__runId`, resolves every member via `$spurBin task show` requiring done/cancelled, dedupes first-seen, and writes run-scoped `.spur/run/$__runId-wrapup-{resolve.status,tasks.json}` (always exit 0; failed edge consumes FAIL); metrics-record consumes the normalized `wrapup-tasks.json` via `jq -r '.[]'` (never re-parses raw `$tasks`), any lookup failure records `wrapup-metrics.status` FAIL; feature-transition validates the sync result with `jq -e 'has("applied")'` and records `wrapup-sync.status` (explicit no-change PASS, invalid result FAIL); doc-sync learnings capture is run-scoped `.spur/run/${vars.__runId}-wrapup-learnings.md` across prompt/answerFile/expectFile/append reader; branch-cleanup description consent-only, no git operation in `done`; transitions: failed edges declared FIRST for task-resolve/metrics-record/feature-transition keyed on status files, sibling routing edges PASS-prefixed, always-defense now routes to `failed` (0758 pilot pin updated).
- `config/workflows/feature-dev.yaml` — integration review is request + ONE collected verdict: shell runs `pr-reviewing.ts request`, captures `head` via `jq -r '.head // empty'`, then a single `collect --head "$HEAD_SHA"` (missing head → FAIL, no wait loop); writes `.spur/run/$__runId-integration-review{,-collect}.status`; blocking edge requires `requireCleanReview=true` AND `collect.status != CLEAN` (REQUESTED/ALREADY_* are request state, never clean evidence); advisory edge → done; note message states both artifact paths statically.
- `config/workflows/task-lifecycle.yaml:23`, `config/workflows/feature-lifecycle.yaml:12` — explicit `version: "1"` identity tags (structure otherwise unchanged; single-edge pins intact).

Tests:

- `packages/app/tests/workflow/wrapup-pipeline.test.ts` (new, 20 tests) — behavior-tested shells (task-resolve validation: malformed JSON/empty runId/unresolvable task/normalization+dedupe; metrics-record: FAIL on missing row, exactly one row appended on success) plus structural pins (version tags ×4, failed state/edges ordering, consent-only branch cleanup, expectFile run-scoped learnings, `has("applied")` sync gate, terminal reachability).
- `packages/app/tests/workflow/proportional-routing-pilots.test.ts` — defense edge pin: always-guard → `failed` with "0770: no resolve status must not claim a skip"; R7 both-forms test strips the new shipped `version: "1"` line before building the unversioned twin.
- `packages/app/tests/workflow/feature-dev-definition.test.ts` — blocking edge pins `!= CLEAN` and the collect status file.

Rationale: wrap-up previously absorbed failures as success (invalid input re-parsed as empty list by sibling guards, missing metrics rows vanished, failed sync printed-and-ignored, shared learnings path overwritten across runs). The fix validates input exactly once, feeds siblings only normalized run-scoped artifacts, and routes every failure through a declared-first `failed` edge.

Evidence: `.spur/run/0770-verdict.json` (PASS, proof sha256 of gate log), `.spur/run/d61-0770-{before,after}.json` (definition digests + gate metrics for 0772).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | From packages/app: `bun test tests/workflow tests/services/corpus-check.test.ts tests/services/corpus-sweep.test.ts --reporter=dots` exited 0 (662 pass, 0 fail). Executed wrapup input/metrics shell fixtures and lifecycle request-transition tests pass; feature-dev requires collected CLEAN when requested, not request acceptance. Four owned definitions validate with version 1. `bun run spur-check` exited 0: 7452 pass, 0 fail; lint/typechecks and 44 pre-check + 2 post-check rules passed. Run evidence `.spur/run/d61-verifyall-gate.log` lines 1-359. Fix-pass disclosure: verification run `.spur/run/0770-verify-answer.txt` lines 1-28; derived verdict `.spur/run/0770-verdict.json` replaced. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Lifecycle and wrapup outcomes remain authoritative | MET | command | From packages/app: `bun test tests/workflow tests/services/corpus-check.test.ts tests/services/corpus-sweep.test.ts --reporter=dots` exited 0 (662 pass, 0 fail). Executed wrapup input/metrics shell fixtures and lifecycle request-transition tests pass; feature-dev requires collected CLEAN when requested, not request acceptance. Four owned definitions validate with version 1. `bun run spur-check` exited 0: 7452 pass, 0 fail; lint/typechecks and 44 pre-check + 2 post-check rules passed. Run evidence `.spur/run/d61-verifyall-gate.log` lines 1-359. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | tests-pass | — | `bun run spur-check` exited 0: 7452 pass, 0 fail; lint/typechecks and 44 pre-check + 2 post-check rules passed. Run evidence `.spur/run/d61-verifyall-gate.log` lines 1-359. |
| P4 | design-conformance | — | DONE: lifecycle edge uniqueness, malformed input failure, run-scoped captures and collected-review gating. External PR requests were mocked by tests; no messages were sent. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0766 --json; spur task show 0767 --json; spur task show 0768 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T07:28:17.593Z todo → wip (system)
- 2026-09-06T07:28:18.040Z wip → testing (system)
- 2026-09-06T07:29:45.532Z testing → done (system)
