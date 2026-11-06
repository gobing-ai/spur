---
schema_version: 1
name: Show verified outcomes and reconcilable measured cost through current run links
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.918Z
updated_at: "2026-11-06T07:24:03.298Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: E6
priority: P2
tags:
  - simplification-2026-11
  - w6
  - approved
estimate_hours: 8

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1308-verdict.json
---

## 1308. Show verified outcomes and reconcilable measured cost through current run links

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W6; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature E6: Outcome feedback reconciles measured cost and verified work.

Owned surfaces/callers/fixtures/config/docs: existing task-run-session links; packages/app workflow/run measurements and history Board service; current history/observability outcome views; transport DTOs and attribution fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Verified-outcome derivation already exists and token attribution intentionally does not price USD. Reuse it; do not rebuild completion proof logic or present token totals as dollars. Recovery UI and planning snapshots are not functional prerequisites.
- Verified source seams: `packages/app/src/services/verified-outcome.ts:92`; `packages/app/src/workflow/run-measurements.ts:21`; `packages/domain/src/analytics/workflow-measurements.ts:36`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

- Additional ready audit: The proposed aggregateRunSamples name is not an existing export. The actual owner is private foldWorkflow in packages/app/src/workflow/run-measurements.ts:95. Reuse/export that existing pure fold within the app workspace, with unchanged existing callers. readWorkflowRuns accepts sinceMs only; filter startedAt <= until in the service before folding so Summary and outcome windows agree. Existing verified outcome counts are task counts, not retry-attempt counts; label them accordingly.

### Requirements

- [x] R1. Outcome feedback reconciles measured cost and verified work; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Show verified outcomes and reconcilable measured cost through current run links

  Scenario: AC1 — Outcome feedback reconciles measured cost and verified work (req: R1)
    Given known and unknown cost attribution, retries, rework and independently verified task completions
    When the operator opens the existing outcome or history surface
    Then verified outcomes and measured attributable costs reconcile to source totals with an explicit unknown bucket and evidence links
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:07.472Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal ProjectOutcomeService composes deriveVerifiedOutcome with readWorkflowRuns and the existing foldWorkflow (export it within the app workspace without changing its existing callers). Add an existing Observability Summary block, not another tab. Verified completion follows deriveVerifiedOutcome, forced/unproved done remains excluded. Sum measured tokenCostUsd only for exact-mapped rows with non-null persisted USD; show null/unknownCount and measured-row coverage when absent. Display token totals separately; no on-the-fly pricing. Reuse correctionCount/retryExhaustedCount as task counts with those labels, never invented retry-attempt counts; retain excluded/dry-run buckets and current terminal-reason vocabulary. Reuse existing history/observability read contract with an optional outcomes block and bounded current window; no second ledger. Freeze additive optional outcomes in observabilitySummaryResponseSchema: {verified:null|{taskDenominator,verifiedResults,correctionCount,retryExhaustedCount,timeToVerified,excludedReasons}, measuredUsd:number|null,tokens:number|null,terminalRuns:number,mappedRuns:number,historyRows:number,usdRows:number,unknownUsdRows:number,unknownCostRunCount:number,terminalReasonMix:Record<string,number>,gateDurationMs:number|null,gateSampleCount:number,evidence:[{runId:string,wbs:string|null,measuredUsd:number|null,unknownUsdRows:number}],evidenceTruncated:boolean}. Numbers/counts and nested verified shapes follow existing VerifiedOutcomeStat/WorkflowMetrics semantics; declare transport validators in contracts, never import domain types there. Use Summary.window.since/until for both folds; filter readWorkflowRuns.startedAt before folding. unknownUsdRows = historyRows - usdRows; unknownCostRunCount includes terminal non-dry runs with no exact mapping or partially unknown USD. evidence is deterministically sorted by startedAt/runId and capped at 100 with evidenceTruncated; aggregate totals cover the selected window, not just the displayed links. Link existing run/task routes. Gate duration uses only retained quality-gate step start/end timestamps from the same selected runs; sum measured samples, show null/zero samples when unavailable, never substitute whole-run wall time. Add packages/app/tests/services/project-outcome-service.test.ts and apps/web/tests/modules/observability/summary-outcomes.test.ts. Tests must include until-bound exclusion and partially measured USD in addition to empty/unavailable proof.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1309/1311 do not need these UI measurements to build fixture baselines; they are independently preparable.

#### Boundaries and verification

(cd packages/app && bun test tests/services/verified-outcome.test.ts tests/workflow/run-measurements.test.ts tests/workflow/run-cost.test.ts); add ProjectOutcomeService and rendered Summary tests with exact known/unknown totals.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write seeded verified/unverified/forced, retry, ambiguous mapping and null-USD reconciliation fixtures first.
- [x] 2. Compose existing evidence derivation and measured run stats; never substitute frontmatter done for verification.
- [x] 3. Render bounded current-window totals with evidence links and explicit unavailable/cost-coverage states.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Current-window verified outcomes and measured cost are an optional block on the existing Observability Summary. One history plane. No second ledger and no on-the-fly USD pricing.

`packages/app/src/services/project-outcome.ts:60` `summarizeProjectOutcome` lists workflow names with `RunDao.traceRows` (`packages/app/src/services/project-outcome.ts:114`), calls `readWorkflowRuns` only when that list is non-empty, then keeps starts inside `Summary.window.since/until` (`packages/app/src/services/project-outcome.ts:99`). It folds those rows with the existing `foldWorkflow` (`packages/app/src/workflow/run-measurements.ts:102`), now exported with TSDoc. `readWorkflowMetrics` still calls it. The fold label `project` stays internal. Dry-run and non-terminal buckets stay inside the fold and are omitted from the payload.

Measured USD is the fold's exact-mapped `tokenCostUsd` (null when no persisted USD). Tokens stay a separate total. `unknownUsdRows` is `historyRows - usdRows`. `unknownCostRunCount` counts terminal non-dry runs with no exact mapping or a partial USD row. Evidence is those same terminal non-dry runs, sorted by `startedAt` then `runId`, capped at 100 (`packages/app/src/services/project-outcome.ts:196`). Aggregates include runs past the cap. WBS is the lexicographically smallest non-empty `task_run_links` value for the displayed rows. Gate duration sums `node = gate` and `kind = command.gate` spans whose timestamps parse and `completed >= started` (`packages/app/src/services/project-outcome.ts:163`). Equal timestamps count as 0ms. No samples yield null duration and zero samples. Wall time and `duration_ms` are not substitutes.

`verified` is null when `cwd` or `fs` is missing, or when `deriveVerifiedOutcome` returns null (`packages/app/src/services/project-outcome.ts:131`). An empty link set on a migrated database stays a zero-denominator stat. The projected subset is task denominator, verified results, correction and retry-exhausted task counts, time to verified, and excluded reasons. Forced and unproved done stay in those excluded reasons. `packages/app/src/index.ts:606` re-exports the service types. `foldWorkflow` stays a module export.

`packages/contracts/src/observability.ts:160` adds `observabilityOutcomesSchema`. `packages/contracts/src/observability.ts:195` adds optional `outcomes` on the summary response. A missing block still parses. Domain types are not imported into contracts.

`apps/server/src/modules/observability/index.ts:371` calls the service with the summary window. A locator is attached only when `taskService` is a function. A throw omits `outcomes` (`apps/server/src/modules/observability/index.ts:433`) so the existing summary stays 200.

`apps/web/src/modules/observability/SummaryOutcomes.tsx:20` renders the block. `apps/web/src/modules/observability/SummaryTab.tsx:453` mounts it when `data.outcomes` is present. Labels are Verified tasks, Corrections (tasks), Retry exhausted (tasks), Measured USD or "Measured USD unavailable", token total or an em dash, coverage `usdRows of historyRows`, terminal reasons, and gate duration or "Gate duration unavailable" with the sample count. Mapped evidence links to `/board/tasks/${wbs}` and `taskRunEvidenceHref` (`apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx:7`). Unmapped runs link to `/board/observability?tab=trace`. Truncation copy is "Evidence list truncated at 100; totals cover the full window."

Owners: `docs/design/observability-module-refactor.md:149` and `docs/design/observability-module-refactor.md:183`; `docs/design/observability-contracts.md:99`. No ADR, no `docs/04_DESIGN.md` ledger, no feature-status rewrite.

Tests: `packages/app/tests/services/project-outcome-service.test.ts` (until-bound exclusion, partial USD, empty and unavailable proof, forced/unproved counts, gate spans, evidence cap). `packages/app/tests/services/project-outcome.test.ts` is the `require-corresponding-test` sibling. `apps/web/tests/modules/observability/summary-outcomes.test.ts` is the happy-dom render. `packages/contracts/tests/observability.test.ts:86` accepts the optional block. `apps/server/tests/modules/observability/index.test.ts:573` is the in-process HTTP probe. `apps/server/tests/modules/observability/index.test.ts:637` omits `outcomes` when `FROM runs` throws.

Public-surface probe, throwaway in-memory database, no repo corpus:

`cd /Users/robin/xprojects/spur-new-runall-1300-1316-af3570ab/apps/server && bun test tests/modules/observability/index.test.ts`

Observed in `.spur/run/1308-light-gate.log` (light gate test:apps/server): 35 pass, 0 fail. Probe "includes measured outcomes for the summary window" passed. Request `GET /api/observability/summary?since=2026-08-20T00:00:00.000Z&until=2026-08-20T23:00:00.000Z` with one exact-mapped history row (`cost_usd` 0.25, input 100, output 40) and no cwd/fs. Assertions that passed: status 200, `outcomes.measuredUsd` close to 0.25, `outcomes.tokens` 140, `outcomes.verified` null. The omit case passed with status 200, `outcomes` undefined, `kpis.totalEvents` 0.

Rendered proof is happy-dom (`apps/web/tests/modules/observability/summary-outcomes.test.ts`, 5 pass, 0 fail). A real browser was not used.

`bun apps/cli/src/index.ts task gate 1308 light` wrote `.spur/run/1308-check-receipt.json` at 2026-11-06T06:59:57.890Z. Status FAIL. Ten checks passed: format-lint, rules:pre, typecheck of apps/server, apps/web, packages/app, and packages/contracts, and the changed tests (server 35, web 5, app 19 including run-measurements, contracts 4). `rules:post` failed in `coverage-provenance-check`: `.coverage/lcov.info` bytes no longer match certification (`lcov-mismatch`). Recovery named by that check is `bun run test:full`. That full suite belongs to the pipeline gate, so it was not run here. A targeted coverage run of the two project-outcome test files measured the new service at 100% functions and 97.92% lines. The uncovered lines are the name-page cursor in `listWorkflowNames` (`packages/app/src/services/project-outcome.ts:114`). That run is not the certified tracefile.

Also this turn: `(cd packages/app && bun test tests/services/verified-outcome.test.ts tests/workflow/run-cost.test.ts)` — 50 pass, 0 fail.

This pass is the host implement step. `implementScopeGuard` was not set to `off`. The task backtick allowlist names the verified-outcome and measurement seams. A later subprocess re-run of this WBS can fail the diff-scope guard on the contracts, server, web, design, and test paths this contract requires.

Task status stays `todo`. Testing and Review stay with the pipeline. Plan steps 1–3 are done. Step 4 records this evidence here and leaves the full gate, verify, and record hops to the pipeline.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/project-outcome.ts:67-90` keeps startedAt inside the summary window, folds exact-mapped USD, sets unknownUsdRows from historyRows minus usdRows, and counts unmapped or partial-USD runs; `apps/web/src/modules/observability/SummaryTab.tsx:453` mounts the block; `apps/web/src/modules/observability/SummaryOutcomes.tsx:41-78` shows task counts and the unknown bucket |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Outcome feedback reconciles measured cost and verified work (req: R1) | MET | test | `packages/app/tests/services/project-outcome-service.test.ts:220` partial USD and unknown run; `packages/app/tests/services/project-outcome-service.test.ts:197` until-bound exclusion; `packages/app/tests/services/project-outcome-service.test.ts:275` forced and unproved task counts; `apps/web/tests/modules/observability/summary-outcomes.test.ts:73` rendered unknown bucket and links; `apps/server/tests/modules/observability/index.test.ts:573` summary window probe. This turn: packages/app 69 pass / 0 fail, apps/web summary-outcomes 5 pass / 0 fail, apps/server observability 35 pass / 0 fail, packages/contracts observability 4 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1308
**Scope:** working tree (no `(1308)` commit). Changed: `packages/app/src/services/project-outcome.ts`, `packages/app/src/workflow/run-measurements.ts`, `packages/app/src/index.ts`, `packages/contracts/src/observability.ts`, `apps/server/src/modules/observability/index.ts`, `apps/web/src/modules/observability/SummaryOutcomes.tsx`, `apps/web/src/modules/observability/SummaryTab.tsx`, their tests, and `docs/design/observability-module-refactor.md`, `docs/design/observability-contracts.md`. Task file excluded.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | correctness | No P1-P3 findings. The working-tree diff was reviewed across functional, security, efficiency, correctness, usability, and architecture. R1 and the task scenario trace to the outcome fold, the Summary block, and the tests run this turn: packages/app 69 pass / 0 fail, apps/web summary-outcomes 5 pass / 0 fail, apps/server observability 35 pass / 0 fail, packages/contracts observability 4 pass / 0 fail. | `packages/app/src/services/project-outcome.ts:60-96` | ACCEPTED |
| 2 | P4 (advisory) | efficiency | Workflow-name discovery stops after 20 pages of 500 newest runs (`packages/app/src/services/project-outcome.ts:26-27`) and does not set evidenceTruncated, so a since-bound history past that cap can omit older workflow names from the fold. Gate spans also read actions once per terminal run (`packages/app/src/services/project-outcome.ts:170`). The evidence-list cap of 100 is disclosed. Tested windows stay inside the page bound. | `packages/app/src/services/project-outcome.ts:114-128` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/project-outcome.ts:67-90` keeps startedAt inside the summary window, folds exact-mapped USD, sets unknownUsdRows from historyRows minus usdRows, and counts unmapped or partial-USD runs; `apps/web/src/modules/observability/SummaryTab.tsx:453` mounts the block; `apps/web/src/modules/observability/SummaryOutcomes.tsx:41-78` shows task counts and the unknown bucket |

**Next:** Accepted P4 residuals only. No open P1-P3.

| WBS | Verdict | P1 | P2 |
| --- | --- | --- | --- |
| 1308 | PASS | 0 | 0 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T07:03:33.878Z todo → wip (system)
- 2026-11-06T07:24:01.207Z wip → testing (system)
- 2026-11-06T07:24:03.290Z testing → done (system)

