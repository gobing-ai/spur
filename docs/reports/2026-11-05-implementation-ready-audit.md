---
title: Simplification program implementation-ready audit
status: refined
created_at: 2026-11-05
updated_at: 2026-11-05
related:
  - docs/plans/2026-11-05-simplification-and-product-enhancement.md
  - docs/reports/2026-11-05-implementation-ready-audit.json
---

# Implementation-ready audit — tasks 1294–1316

All 23 specifications are refined to ready depth. Twenty-one are todo; 1310 and 1312 remain
blocked pending a current positive fixture decision from 1309 and 1311 respectively. Ready
here means the implementation contract is settled. It does not mean dependencies are done,
the code is implemented, or an implementation verification PASS exists.

The [JSON receipt](2026-11-05-implementation-ready-audit.json) carries all seven native readiness
checks for each task, its current planning digest, source anchors, task checks, feature checks
and dependency projection. It supersedes the scheduling snapshot in the
[initial handoff](2026-11-05-simplification-corpus-handoff.md); task files remain authoritative.

## What was settled

- Preserve the existing pull-sync review fix and verify draft retention; remove the inert dependency checkbox.
- Fail closed at planning list/derivation seams, then reuse a per-operation snapshot without a long-lived cache.
- Keep the installed oRPC transport; use one planning subscription and a fixed deterministic readiness response.
- Freeze npm/pnpm and Cargo/Go detection precedence; Python requires declared commands and ambiguous roots stay unbound.
- Preserve intentional host/fleet/subprocess differences while sharing only truly common policy and finalization.
- Reuse the existing verified-outcome and workflow folds; show measured USD coverage and unknown values explicitly.
- Bound conditional analytics work to time predicates and migration generation to the existing 0037 SQL artifact.
- Use native TOML, remove the unused internal registry stub, and share the production fetch seam with its mock.
- Remove wave-order dependencies that were not actual consumed contracts. No new dependency or public CLI verb is selected.

## Current task handoff

| Task | Owner | Scheduling | Direct prerequisites |
| --- | --- | --- | --- |
| [1294 — Make feature sync and dependency controls match effective runner behavior](../tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md) | F8 | todo → todo | — |
| [1295 — Restore ordinary-suite execution of real-renderer Markdown security proofs](../tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md) | H16 | todo → todo | — |
| [1296 — Reject incomplete planning inputs before deriving feature state](../tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md) | F22 | todo → todo | — |
| [1297 — Reuse an operation-scoped planning snapshot across corpus readers](../tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md) | F22 | todo → todo | 1296 |
| [1298 — Keep task-store refreshes owned by the latest folder and subscription](../tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md) | F7 | todo → todo | — |
| [1299 — Preserve bounded exact-search failures and skipped fuzzy outcomes](../tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md) | A34 | todo → todo | — |
| [1300 — Converge planning Board procedures on existing validated oRPC transport](../tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md) | F73 | todo → todo | — |
| [1301 — Share planning-event invalidation across task and feature views](../tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md) | F73 | todo → todo | 1298 |
| [1302 — Explain ready work, blocking dependencies and paused runs in planning views](../tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md) | F73 | todo → todo | 1297, 1301 |
| [1303 — Propose safe npm and pnpm bindings through existing init actions](../tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md) | A92 | todo → todo | — |
| [1304 — Complete language and monorepo action onboarding without guessing commands](../tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md) | A92 | todo → todo | 1303 |
| [1305 — Unify executor admission and invocation policy across existing dispatch surfaces](../tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md) | D65 | todo → todo | — |
| [1306 — Share executor result finalization while preserving receipts and partial work](../tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md) | D65 | todo → todo | 1305 |
| [1307 — Link task failures and paused runs to retained evidence and safe recovery](../tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md) | E71 | todo → todo | 1306 |
| [1308 — Show verified outcomes and reconcilable measured cost through current run links](../tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md) | E6 | todo → todo | — |
| [1309 — Measure raw rollup and mart parity before selecting query simplification](../tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md) | E94 | blocked → todo | — |
| [1310 — Consolidate only proven equivalent history selectors and measures](../tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md) | E94 | blocked → blocked | 1309 |
| [1311 — Prove migration SQL ownership and offline upgrade parity on fixtures](../tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md) | A331 | blocked → todo | — |
| [1312 — Generate offline migration embedding from verified authoritative SQL](../tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md) | A331 | blocked → blocked | 1311 |
| [1313 — Classify executable shell positions without blocking literal read-only searches](../tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md) | A6 | todo → todo | — |
| [1314 — Parse coverage diagnostic thresholds with the native TOML parser](../tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md) | C3 | todo → todo | — |
| [1315 — Remove unsupported runtime registration promises from the Board registry](../tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md) | A8 | todo → todo | — |
| [1316 — Reduce duplicated test mocks behind retained behavioral and gate evidence](../tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md) | H16 | blocked → todo | 1295 |

Start with the trust fixes (1294–1296, 1298–1299), then 1297. The remaining independent
roots may be scheduled separately; they are not prerequisites for unrelated slices. Keep one
writer per working tree. The dependency projection is sequencing evidence, not authorization
for parallel writers. Same-file executor tasks remain ordered 1305 → 1306.

1310 requires a `go` for `time-range-predicates`; 1312 requires a `go` for
`0037-dimension-marts`. Their producer tasks freeze artifact fields, source revision/digests,
fixtures and repeatable commands. A stale, inconclusive or no-go result does not unblock implementation.

## Validation and limits

- All 23 task checks and all 23 target-todo implementation prechecks pass with no error findings.
- Native `verifyReadyChecks` validates all 161 evidence rows; native `lintPremiseEvidence` validates cited paths/line ranges.
- All 15 affected feature checks pass. All 27 added scenarios retain exactly one covering task; historical titles are preserved.
- All affected feature rosters and the generated index were refreshed through Spur.
- The dependency graph includes all 23 tasks once and has no cycle.
- One worktree at `3a1f675f1c1834b6236e980dfae71b01712a321c`; the five configured task folders report no wip tasks.
- Existing source changes and review artifacts are preserved. No implementation pipeline or code change ran during this refinement.

Task advisories: `{"L4.prerequisite-not-done": 10, "L4.readiness-blocked": 2}`.

Feature advisories: `{"L4.evidence-not-recoverable": 4, "L4.scenario-unverified": 35, "L4.uncovered-feature-scenario": 10}`.

Undone prerequisites, blocked go/no-go conditions and unverified new scenarios are expected for
planned work. Older unrecoverable evidence and uncovered scenarios on F7/F8/H16 remain visible;
they were not waived, fabricated or expanded into unrelated work. No scenario was dropped.

Focused probes reproduced silent EACCES omission, stale folder response ownership, valid TOML
table omission, literal-search guard refusal, output-budget empty success and skipped-fuzzy `[]`.
Their observations are copied into the JSON receipt; these are defect confirmations, not passing
implementation tests. The test commands in task Design sections are instructions for future execution.

No full code test/build gate was rerun for this planning-only refinement. The earlier review gate
search failure remains owned by 1299. `git diff --check` still reports the tool-emitted blank EOF
line on F8; the tool-owned corpus was not raw-edited to hide it.

To recheck later, use the source-local CLI with `task show <wbs> --json --no-logo`,
`task check <wbs> --as todo --precheck --json --no-logo` and
`feature check <id> --json --no-logo`. Recompute each planning digest with the existing
`computePlanningDigest` helper before relying on this receipt. Source drift requires a new
premise audit even when the task planning digest is unchanged.

## Per-task corrections and ready checklist

### 1294 — Make feature sync and dependency controls match effective runner behavior

Task: [docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md](../tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md). Outcome: refined; specification ready; scheduling todo.

The pull default and disabled push already exist in the starting diff; retain them and add the missing draft-preservation assertion. skipDeps is serialized but runFeatureActionJob never consumes it. The chosen fix is removal of the inert feature-action checkbox, not a new bypass or additional UI state.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:45 freezes observable R-items; docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/server/src/serve.ts:623; apps/web/src/modules/features/FeatureDetail.tsx:95; apps/web/src/modules/features/FeatureDetail.tsx:900. |
| plan | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/modules/features/feature-sync.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-actions.test.ts); (cd apps/server && bun test tests/modules/feature/handlers.test.ts tests/modules/feature/transition-gate.test.ts). Save feature-sync JUnit and draft DOM assertions. |
| ac | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:50 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:66 records closed choices; no unresolved API/library selection. Closed: remove the unsupported control. Do not add dependency skipping to the runner. |
| dependencies | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:78 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md:23 records current-source corrections: The pull default and disabled push already exist in the starting diff; retain them and add the missing draft-preservation assertion. skipDeps is serialized but runFeatureActionJob never consumes it. The chosen fix is removal of the inert feature-action checkbox, not a new bypass or additional UI state. Inspected seams: apps/server/src/serve.ts:623; apps/web/src/modules/features/FeatureDetail.tsx:95; apps/web/src/modules/features/FeatureDetail.tsx:900. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1295 — Restore ordinary-suite execution of real-renderer Markdown security proofs

Task: [docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md](../tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md). Outcome: refined; specification ready; scheduling todo.

The 12-case real-renderer probe is not discoverable; its stated wrapper does not exist. The existing member-terminal wrapper is a concrete isolation/child-JUnit precedent. Keep this proof in the normal suite.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:43 freezes observable R-items; docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:11; apps/web/tests/modules/projects/member-terminal-identity.test.ts:19. |
| plan | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/modules/task-kanban/markdown-safety.test.ts tests/lib/markdown-safety.test.ts); (cd apps/web && bun test --isolate ./tests/modules/task-kanban/markdown-safety-pipeline.tsx). Save the child JUnit and failure-control result. |
| ac | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md:23 records current-source corrections: The 12-case real-renderer probe is not discoverable; its stated wrapper does not exist. The existing member-terminal wrapper is a concrete isolation/child-JUnit precedent. Keep this proof in the normal suite. Inspected seams: apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:11; apps/web/tests/modules/projects/member-terminal-identity.test.ts:19. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1296 — Reject incomplete planning inputs before deriving feature state

Task: [docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md](../tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md). Outcome: refined; specification ready; scheduling todo.

The earlier text called TaskLocator an error-taxonomy precedent but it actually treats ENOTDIR as missing. Keep its unrelated lookup behavior intact here; fail closed at the list/feature-derivation read seam instead. Freeze all-or-error transport now; a tolerant new DTO is not required for containment.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:43 freezes observable R-items; docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/task-query-ops.ts:90; packages/app/src/services/feature-service.ts:892; packages/app/src/services/task-locator.ts:50. |
| plan | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/task-locator.test.ts); (cd apps/server && bun test tests/modules/task/handlers.test.ts tests/modules/feature/handlers.test.ts). Add a disposable-project CLI/HTTP refusal proof and assert corpus bytes unchanged. |
| ac | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md:23 records current-source corrections: The earlier text called TaskLocator an error-taxonomy precedent but it actually treats ENOTDIR as missing. Keep its unrelated lookup behavior intact here; fail closed at the list/feature-derivation read seam instead. Freeze all-or-error transport now; a tolerant new DTO is not required for containment. Inspected seams: packages/app/src/services/task-query-ops.ts:90; packages/app/src/services/feature-service.ts:892; packages/app/src/services/task-locator.ts:50. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1297 — Reuse an operation-scoped planning snapshot across corpus readers

Task: [docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md](../tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md). Outcome: refined; specification ready; scheduling todo.

Snapshot reuse needs an operation boundary and frozen shape. A singleton/request-spanning cache would change freshness; use an explicitly passed snapshot and keep original public service signatures.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:43 freezes observable R-items; docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/task-query-ops.ts:119; packages/app/src/services/feature-service.ts:906; packages/app/src/services/task-locator.ts:91. |
| plan | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/feature-check.test.ts tests/services/task-check.test.ts); add tests/services/planning-snapshot.test.ts with instrumented fs counts and CLI/HTTP golden outputs. |
| ac | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:70 names 1296 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md:23 records current-source corrections: Snapshot reuse needs an operation boundary and frozen shape. A singleton/request-spanning cache would change freshness; use an explicitly passed snapshot and keep original public service signatures. Inspected seams: packages/app/src/services/task-query-ops.ts:119; packages/app/src/services/feature-service.ts:906; packages/app/src/services/task-locator.ts:91. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1298 — Keep task-store refreshes owned by the latest folder and subscription

Task: [docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md](../tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md). Outcome: refined; specification ready; scheduling todo.

Generation ownership and burst coalescing must distinguish a folder change from another request in the same generation. Do not serialize a new folder behind a hung old request.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:43 freezes observable R-items; docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:76 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:76 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/src/modules/task-kanban/useTasks.ts:86; apps/web/src/modules/task-kanban/useTasks.ts:113; apps/web/src/modules/features/FeatureDetail.tsx:133. |
| plan | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:94 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/modules/task-kanban/useTasks.test.ts). Add a rendered folder-switch case and save request counts/final DOM state with controlled promises rather than real timer waits. |
| ac | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:48 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:64 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:76 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md:23 records current-source corrections: Generation ownership and burst coalescing must distinguish a folder change from another request in the same generation. Do not serialize a new folder behind a hung old request. Inspected seams: apps/web/src/modules/task-kanban/useTasks.ts:86; apps/web/src/modules/task-kanban/useTasks.ts:113; apps/web/src/modules/features/FeatureDetail.tsx:133. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1299 — Preserve bounded exact-search failures and skipped fuzzy outcomes

Task: [docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md](../tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md). Outcome: refined; specification ready; scheduling todo.

Both defects reproduced again during this audit: output overflow returns successful zero hits; auto skipped fuzzy returns []. Unknown-status and missing-index failure fixtures must be explicit; nonempty status output is currently optimistically ready. Freeze an explicit error at the cap instead of a new streaming implementation.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:43 freezes observable R-items; docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:76 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:76 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/search.ts:189; packages/app/src/services/search.ts:67; packages/app/src/services/search-zg.ts:115. |
| plan | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:94 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/search.test.ts tests/services/search-zg.test.ts); (cd apps/cli && bun test tests/commands/self/search.test.ts); (cd apps/server && bun test tests/modules/search/handlers.test.ts). Save two-3MB-lines repro and bounded error result. |
| ac | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:48 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:64 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:76 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md:23 records current-source corrections: Both defects reproduced again during this audit: output overflow returns successful zero hits; auto skipped fuzzy returns []. Unknown-status and missing-index failure fixtures must be explicit; nonempty status output is currently optimistically ready. Freeze an explicit error at the cap instead of a new streaming implementation. Inspected seams: packages/app/src/services/search.ts:189; packages/app/src/services/search.ts:67; packages/app/src/services/search-zg.ts:115. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1300 — Converge planning Board procedures on existing validated oRPC transport

Task: [docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md](../tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md). Outcome: refined; specification ready; scheduling todo.

Plans/designs are read-only raw Hono routes in health/index.ts, not missing mutation APIs. Their response shapes differ from the feature envelope. No dependency on corpus containment or search is necessary; remove those artificial edges.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:43 freezes observable R-items; docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/src/lib/plan-client.ts:23; apps/web/src/lib/design-client.ts:23; apps/server/src/modules/health/index.ts:951; packages/contracts/src/index.ts:25. |
| plan | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/server && bun test tests/modules/plans.test.ts tests/modules/designs.test.ts tests/modules/feature/handlers.test.ts); (cd apps/web && bun test tests/lib/plan-client.test.ts tests/lib/design-client.test.ts tests/lib/feature-client.test.ts). Add fixture HTTP-to-real-client proof and update owning contracts. |
| ac | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:58 records closed choices; no unresolved API/library selection. Closed: retain Hono aliases but give each read one application owner; no TanStack dependency pilot in this task. |
| dependencies | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md:23 records current-source corrections: Plans/designs are read-only raw Hono routes in health/index.ts, not missing mutation APIs. Their response shapes differ from the feature envelope. No dependency on corpus containment or search is necessary; remove those artificial edges. Inspected seams: apps/web/src/lib/plan-client.ts:23; apps/web/src/lib/design-client.ts:23; apps/server/src/modules/health/index.ts:951; packages/contracts/src/index.ts:25. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1301 — Share planning-event invalidation across task and feature views

Task: [docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md](../tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md). Outcome: refined; specification ready; scheduling todo.

Transport conversion is independent of event connection ownership. Remove dependency 1300; retain 1298 because the new stream invalidation must use its source/lifetime and trailing-refresh rules.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:43 freezes observable R-items; docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/src/modules/features/FeaturesShell.tsx:105; apps/web/src/modules/features/useFeatureActionProgress.ts:39; apps/web/src/modules/task-kanban/useTasks.ts:157. |
| plan | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/modules/task-kanban/useTasks.test.ts tests/modules/features/useFeatureActionProgress.test.ts tests/modules/features/sse-helpers.test.ts); add tests/lib/planning-events.test.ts and rendered multi-view proof. |
| ac | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:70 names 1298 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:23 records current-source corrections: Transport conversion is independent of event connection ownership. Remove dependency 1300; retain 1298 because the new stream invalidation must use its source/lifetime and trailing-refresh rules. Inspected seams: apps/web/src/modules/features/FeaturesShell.tsx:105; apps/web/src/modules/features/useFeatureActionProgress.ts:39; apps/web/src/modules/task-kanban/useTasks.ts:157. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1302 — Explain ready work, blocking dependencies and paused runs in planning views

Task: [docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md](../tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md). Outcome: refined; specification ready; scheduling todo.

The first design did not freeze a readiness algorithm or response. Use existing deterministic checks and task/run data, not a second advice engine. Add a read-only procedure rather than changing task.list success shapes.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:43 freezes observable R-items; docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/planning-preflight.ts:27; packages/app/src/services/task-check.ts:480; packages/app/src/services/run-store-service.ts:260; packages/contracts/src/task.ts:155. |
| plan | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. Add packages/app/tests/services/planning-readiness.test.ts, apps/server/tests/modules/task/readiness.test.ts and apps/web/tests/modules/task-kanban/readiness.test.ts. Save a single fixture CLI-check/HTTP/DOM journey and zero-model-dispatch assertion. |
| ac | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:70 names 1297, 1301 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md:23 records current-source corrections: The first design did not freeze a readiness algorithm or response. Use existing deterministic checks and task/run data, not a second advice engine. Add a read-only procedure rather than changing task.list success shapes. Inspected seams: packages/app/src/services/planning-preflight.ts:27; packages/app/src/services/task-check.ts:480; packages/app/src/services/run-store-service.ts:260; packages/contracts/src/task.ts:155. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1303 — Propose safe npm and pnpm bindings through existing init actions

Task: [docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md](../tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md). Outcome: refined; specification ready; scheduling todo.

No working-directory field exists in builder.actions and no init preview flag exists. Keep the current action string/array schema; place subdirectory commands behind existing quoting/cwd behavior. UI fixes and Markdown proof are not functional dependencies.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:43 freezes observable R-items; docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/cli/src/commands/init.ts:70; packages/app/src/services/sdlc-actions.ts:66; apps/cli/src/commands/self/exec.ts:39. |
| plan | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Save generated YAML, inspection JSON and fixture check exit. |
| ac | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md:23 records current-source corrections: No working-directory field exists in builder.actions and no init preview flag exists. Keep the current action string/array schema; place subdirectory commands behind existing quoting/cwd behavior. UI fixes and Markdown proof are not functional dependencies. Inspected seams: apps/cli/src/commands/init.ts:70; packages/app/src/services/sdlc-actions.ts:66; apps/cli/src/commands/self/exec.ts:39. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1304 — Complete language and monorepo action onboarding without guessing commands

Task: [docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md](../tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md). Outcome: refined; specification ready; scheduling todo.

Freeze conservative language defaults and package selection. Do not assume Python project.scripts are shell actions or introduce a cwd schema. The selected fixture root and quoted command prefix suffice.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:43 freezes observable R-items; docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/cli/src/commands/self/exec.ts:32; packages/app/src/services/sdlc-actions.ts:103; apps/cli/src/commands/init.ts:353. |
| plan | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Use fixture executable stubs for deterministic discovery and separately report real-tool availability. Verify Cargo/Go semantics against the official references recorded in Q&A. |
| ac | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:58 records closed choices; no unresolved API/library selection. Closed: use the conservative mapping above. Sources checked: https://doc.rust-lang.org/cargo/commands/cargo-check.html ; https://doc.rust-lang.org/cargo/commands/cargo-test.html ; https://pkg.go.dev/cmd/go . Python defaults remain unbound without declared project commands. |
| dependencies | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:70 names 1303 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md:23 records current-source corrections: Freeze conservative language defaults and package selection. Do not assume Python project.scripts are shell actions or introduce a cwd schema. The selected fixture root and quoted command prefix suffice. Inspected seams: apps/cli/src/commands/self/exec.ts:32; packages/app/src/services/sdlc-actions.ts:103; apps/cli/src/commands/init.ts:353. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1305 — Unify executor admission and invocation policy across existing dispatch surfaces

Task: [docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md](../tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md). Outcome: refined; specification ready; scheduling todo.

Current dispatch branches have intentionally different observable guarantees: host returns a work item before subprocess-only capability/budget checks. Do not pretend every old policy already applies identically. Remove unrelated Board/search prerequisites and freeze a behavior-preserving extraction first.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:43 freezes observable R-items; docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/workflow/actions/agent-run.ts:633; packages/app/src/workflow/actions/agent-run.ts:905; packages/app/src/workflow/actions/agent-run.ts:311. |
| plan | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/host-executor.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/fleet-dispatch.test.ts). Save admission matrix with intentional surface differences. |
| ac | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:58 records closed choices; no unresolved API/library selection. Closed: preserve observable behavior; unify only shared semantics. A stronger enforcement guarantee would require a separately designed change, not this refactor. |
| dependencies | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md:23 records current-source corrections: Current dispatch branches have intentionally different observable guarantees: host returns a work item before subprocess-only capability/budget checks. Do not pretend every old policy already applies identically. Remove unrelated Board/search prerequisites and freeze a behavior-preserving extraction first. Inspected seams: packages/app/src/workflow/actions/agent-run.ts:633; packages/app/src/workflow/actions/agent-run.ts:905; packages/app/src/workflow/actions/agent-run.ts:311. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1306 — Share executor result finalization while preserving receipts and partial work

Task: [docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md](../tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md). Outcome: refined; specification ready; scheduling todo.

Receipt writing is already shared by execute/recordReceipt. Do not create a second finalizer or duplicate failure classification. Share repeated post-condition/freshness result preparation around the existing one writer, preserving the host receipt exception.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:43 freezes observable R-items; docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/workflow/actions/agent-run.ts:587; packages/app/src/workflow/actions/agent-run.ts:598; packages/app/src/services/failure-classification.ts:6. |
| plan | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/host-executor.test.ts tests/services/workflow-host-executor.test.ts). Real-agent dogfood is separately reported; fake process fixtures must prove containment without external agent availability. |
| ac | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:58 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:70 names 1305 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md:23 records current-source corrections: Receipt writing is already shared by execute/recordReceipt. Do not create a second finalizer or duplicate failure classification. Share repeated post-condition/freshness result preparation around the existing one writer, preserving the host receipt exception. Inspected seams: packages/app/src/workflow/actions/agent-run.ts:587; packages/app/src/workflow/actions/agent-run.ts:598; packages/app/src/services/failure-classification.ts:6. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1307 — Link task failures and paused runs to retained evidence and safe recovery

Task: [docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md](../tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md). Outcome: refined; specification ready; scheduling todo.

RunStoreService, task-run links, progress and run-record outcomes already exist. Recovery navigation does not require the new readiness panel, so remove the 1302 dependency and reuse existing routes.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:43 freezes observable R-items; docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:76 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:76 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/run-store-service.ts:77; packages/contracts/src/runs.ts:82; apps/web/src/modules/observability/TraceTab.tsx:106. |
| plan | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:94 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/run-store-service.test.ts tests/workflow/run-record.test.ts); (cd apps/server && bun test tests/modules/runs/index.test.ts). Add apps/web/tests/modules/observability/run-recovery.test.ts rendered/HTTP journey. |
| ac | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:48 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:64 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:76 names 1306 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md:23 records current-source corrections: RunStoreService, task-run links, progress and run-record outcomes already exist. Recovery navigation does not require the new readiness panel, so remove the 1302 dependency and reuse existing routes. Inspected seams: packages/app/src/services/run-store-service.ts:77; packages/contracts/src/runs.ts:82; apps/web/src/modules/observability/TraceTab.tsx:106. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1308 — Show verified outcomes and reconcilable measured cost through current run links

Task: [docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md](../tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md). Outcome: refined; specification ready; scheduling todo.

Verified-outcome derivation already exists and token attribution intentionally does not price USD. Reuse it; do not rebuild completion proof logic or present token totals as dollars. Recovery UI and planning snapshots are not functional prerequisites. The proposed aggregateRunSamples name is not an existing export. The actual owner is private foldWorkflow in packages/app/src/workflow/run-measurements.ts:95. Reuse/export that existing pure fold within the app workspace, with unchanged existing callers. readWorkflowRuns accepts sinceMs only; filter startedAt <= until in the service before folding so Summary and outcome windows agree. Existing verified outcome counts are task counts, not retry-attempt counts; label them accordingly.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:45 freezes observable R-items; docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:72 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:72 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/verified-outcome.ts:92; packages/app/src/workflow/run-measurements.ts:21; packages/domain/src/analytics/workflow-measurements.ts:36; packages/app/src/workflow/run-measurements.ts:95; packages/domain/src/analytics/workflow-measurements.ts:76; packages/contracts/src/observability.ts:96. |
| plan | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:90 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/verified-outcome.test.ts tests/workflow/run-measurements.test.ts tests/workflow/run-cost.test.ts); add ProjectOutcomeService and rendered Summary tests with exact known/unknown totals. |
| ac | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:49 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:60 records closed choices; no unresolved API/library selection.  |
| dependencies | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:72 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md:23 records current-source corrections: Verified-outcome derivation already exists and token attribution intentionally does not price USD. Reuse it; do not rebuild completion proof logic or present token totals as dollars. Recovery UI and planning snapshots are not functional prerequisites. The proposed aggregateRunSamples name is not an existing export. The actual owner is private foldWorkflow in packages/app/src/workflow/run-measurements.ts:95. Reuse/export that existing pure fold within the app workspace, with unchanged existing callers. readWorkflowRuns accepts sinceMs only; filter startedAt <= until in the service before folding so Summary and outcome windows agree. Existing verified outcome counts are task counts, not retry-attempt counts; label them accordingly. Inspected seams: packages/app/src/services/verified-outcome.ts:92; packages/app/src/workflow/run-measurements.ts:21; packages/domain/src/analytics/workflow-measurements.ts:36; packages/app/src/workflow/run-measurements.ts:95; packages/domain/src/analytics/workflow-measurements.ts:76; packages/contracts/src/observability.ts:96. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1309 — Measure raw rollup and mart parity before selecting query simplification

Task: [docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md](../tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md). Outcome: refined; specification ready; scheduling todo.

This evidence task can run now on disposable seeded fixtures; W6 output is not a functional dependency. Freeze one candidate for its downstream task instead of leaving candidate selection to that implementer.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:43 freezes observable R-items; docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/domain/tests/analytics/rollup-equivalence.test.ts:35; packages/domain/src/analytics/history-board-rollup.ts:711; packages/domain/src/analytics/history-board-marts.ts:300. |
| plan | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/domain && bun test tests/analytics/rollup-equivalence.test.ts tests/analytics/history-board-rollup.test.ts); (cd packages/app && bun test tests/services/history-board-service.test.ts). Add a fixture evidence test and publish golden predicate vectors. |
| ac | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:58 records closed choices; no unresolved API/library selection. Closed: evidence work is runnable without W6. Preserve 1310 as blocked pending an explicit positive artifact. |
| dependencies | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:78 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md:23 records current-source corrections: This evidence task can run now on disposable seeded fixtures; W6 output is not a functional dependency. Freeze one candidate for its downstream task instead of leaving candidate selection to that implementer. Inspected seams: packages/domain/tests/analytics/rollup-equivalence.test.ts:35; packages/domain/src/analytics/history-board-rollup.ts:711; packages/domain/src/analytics/history-board-marts.ts:300. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1310 — Consolidate only proven equivalent history selectors and measures

Task: [docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md](../tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md). Outcome: refined; specification ready; scheduling blocked.

The previous design allowed an unknown future consolidation target. Freeze only the existing duplicated time bounds and exclude token aggregates/filter routing.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:43 freezes observable R-items; docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/domain/src/analytics/history-board-rollup.ts:711; packages/domain/src/analytics/history-board-marts.ts:300. |
| plan | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/domain && bun test tests/analytics/rollup-equivalence.test.ts tests/analytics/history-board-rollup.test.ts); add selector-time-range tests. Use exact integer/null equality and existing 1e-9 allocated-token tolerance. |
| ac | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:58 records closed choices; no unresolved API/library selection. Deferred with explicit owner: task 1309 provides the go/no-go artifact. Implementation shape is frozen; scheduling remains blocked until a go exists. |
| dependencies | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:78 names 1309 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=blocked; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md:23 records current-source corrections: The previous design allowed an unknown future consolidation target. Freeze only the existing duplicated time bounds and exclude token aggregates/filter routing. Inspected seams: packages/domain/src/analytics/history-board-rollup.ts:711; packages/domain/src/analytics/history-board-marts.ts:300. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1311 — Prove migration SQL ownership and offline upgrade parity on fixtures

Task: [docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md](../tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md). Outcome: refined; specification ready; scheduling todo.

The runtime migration journal records id and applied_at, not SQL checksums. Preserve hashes as audit evidence, not a fictitious enforced DB field. Remove the W6 UI dependency; fixture evidence is runnable now.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:43 freezes observable R-items; docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/domain/src/migrations.ts:1407; packages/domain/src/migrations.ts:2046; packages/domain/src/migrations.ts:1305. |
| plan | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/domain && bun test tests/dao/migrations.test.ts); add a fixture ownership/parity proof and use the existing CLI build path for a disposable source-free smoke when available. Preserve all legacy reference files read-only. |
| ac | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:58 records closed choices; no unresolved API/library selection. Closed: fixture evidence can begin now. Runtime checksums are not invented, and historical SQL is not rewritten. |
| dependencies | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:78 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md:23 records current-source corrections: The runtime migration journal records id and applied_at, not SQL checksums. Preserve hashes as audit evidence, not a fictitious enforced DB field. Remove the W6 UI dependency; fixture evidence is runnable now. Inspected seams: packages/domain/src/migrations.ts:1407; packages/domain/src/migrations.ts:2046; packages/domain/src/migrations.ts:1305. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1312 — Generate offline migration embedding from verified authoritative SQL

Task: [docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md](../tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md). Outcome: refined; specification ready; scheduling blocked.

Freeze one static mirror as a safe generation pilot instead of waiting for unspecified upstream SQL exports. All migration control flow and other mirrors remain unchanged.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:43 freezes observable R-items; docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/domain/src/migrations.ts:1305; packages/domain/src/migrations.ts:1553; scripts/commands/build-cli.ts:32. |
| plan | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/domain && bun test tests/dao/migrations.test.ts); add scripts/commands/emit-migration-sql.test.ts; run the required CLI bundle/relink checks only during implementation. Save IDs, SQL hashes, fixture schema comparison and offline binary result. |
| ac | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:58 records closed choices; no unresolved API/library selection. Deferred owner: task 1311 decides measured safety/benefit. The generator source, target and pilot migration are fixed. |
| dependencies | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:78 names 1311 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=blocked; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md:23 records current-source corrections: Freeze one static mirror as a safe generation pilot instead of waiting for unspecified upstream SQL exports. All migration control flow and other mirrors remain unchanged. Inspected seams: packages/domain/src/migrations.ts:1305; packages/domain/src/migrations.ts:1553; scripts/commands/build-cli.ts:32. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1313 — Classify executable shell positions without blocking literal read-only searches

Task: [docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md](../tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md). Outcome: refined; specification ready; scheduling todo.

Do not leave parser/library choice open or claim a complete shell parser is needed. Freeze a conservative lexical pass: allow only proven literal read-only searches; everything ambiguous retains the current classifier behavior.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:43 freezes observable R-items; docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: plugins/sp/lib/destructive-policy.ts:190; plugins/sp/lib/destructive-policy.ts:185; plugins/sp/scripts/hooks/careful-guard.ts:84. |
| plan | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts). Extend the existing shared classifier matrix in destructive-policy.test.ts. Save false-positive and destructive control matrix; plugin-smoke is required only if actual plugin dependency graph changes. |
| ac | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:58 records closed choices; no unresolved API/library selection. Closed: use a bounded internal lexer and conservative fallback; no new parser package, no claim of full shell-language coverage. |
| dependencies | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md:23 records current-source corrections: Do not leave parser/library choice open or claim a complete shell parser is needed. Freeze a conservative lexical pass: allow only proven literal read-only searches; everything ambiguous retains the current classifier behavior. Inspected seams: plugins/sp/lib/destructive-policy.ts:190; plugins/sp/lib/destructive-policy.ts:185; plugins/sp/scripts/hooks/careful-guard.ts:84. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1314 — Parse coverage diagnostic thresholds with the native TOML parser

Task: [docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md](../tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md). Outcome: refined; specification ready; scheduling todo.

Current helper callers expect null for malformed text and support a root-level legacy snippet. Freeze those behaviors rather than introducing new exceptions or changing the full gate outcome.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:43 freezes observable R-items; docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: packages/app/src/services/quality-gate.ts:172; packages/app/tests/services/quality-gate.test.ts:330; scripts/commands/run-tests.ts:228. |
| plan | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd packages/app && bun test tests/services/quality-gate.test.ts tests/services/quality-gate-main.test.ts tests/services/quality-gate-receipt.test.ts). No new dependency; no whole coverage-policy rewrite. |
| ac | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:58 records closed choices; no unresolved API/library selection. Closed: preserve null on malformed/missing settings and the legacy helper snippet; this is diagnostic parsing, not gate-policy tightening. |
| dependencies | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md:23 records current-source corrections: Current helper callers expect null for malformed text and support a root-level legacy snippet. Freeze those behaviors rather than introducing new exceptions or changing the full gate outcome. Inspected seams: packages/app/src/services/quality-gate.ts:172; packages/app/tests/services/quality-gate.test.ts:330; scripts/commands/run-tests.ts:228. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1315 — Remove unsupported runtime registration promises from the Board registry

Task: [docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md](../tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md). Outcome: refined; specification ready; scheduling todo.

The current caller search finds only registry implementation/exports and its tests. The public Board declaration source is contribution.ts, not Registry. Freeze removal of the unused internal method rather than leaving a compatibility choice to implementation.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:43 freezes observable R-items; docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:70 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:70 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/src/modules/registry.ts:20; apps/web/tests/modules/registry.test.ts:90; scripts/commands/emit-board-types.ts:20. |
| plan | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:88 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts); run declaration emit check and typecheck. Use installed Board fixtures where required, not a new loader. |
| ac | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:58 records closed choices; no unresolved API/library selection. Closed: remove the unused internal operation. A newly introduced production consumer is source drift, not an open design option. |
| dependencies | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:70 names no direct prerequisite and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md:23 records current-source corrections: The current caller search finds only registry implementation/exports and its tests. The public Board declaration source is contribution.ts, not Registry. Freeze removal of the unused internal method rather than leaving a compatibility choice to implementation. Inspected seams: apps/web/src/modules/registry.ts:20; apps/web/tests/modules/registry.test.ts:90; scripts/commands/emit-board-types.ts:20. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |

### 1316 — Reduce duplicated test mocks behind retained behavioral and gate evidence

Task: [docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md](../tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md). Outcome: refined; specification ready; scheduling todo.

A concrete duplicated family is now identified: the shared rpc-client mock duplicates fetch timeout/cancellation code and diverges (10s vs 30s, missing pre-abort/reason/listener cleanup). This is no longer blocked on discovering a candidate or on SSE migration.

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:43 freezes observable R-items; docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:78 states scope/preservation boundaries. |
| design | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:78 freezes names, source owners, algorithm/precedence and handoff. Current seams: apps/web/tests/test-helpers/rpc-client-mock.ts:32; apps/web/src/lib/rpc-client.ts:42; apps/web/src/lib/rpc-client.ts:61. |
| plan | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:96 orders failure controls before production changes and ends with focused checks, owner sync and actual harness evidence. (cd apps/web && bun test tests/lib/rpc-client.test.ts tests/rpc-client.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-sync.test.ts). Add tests/lib/rpc-fetch.test.ts with controlled timeout/abort fixtures. Repeat ordinary discovery and preserve source-boundary tests. |
| ac | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:47 preserves every AC title and req:R mapping; source-local task check/precheck passed and feature scenario coverage is one owner per added scenario. |
| decisions | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:58 records closed choices; no unresolved API/library selection. Closed: use the existing duplicated fetch seam as the measured candidate; preserve production behavior and remove the mock copy. This task can be todo after 1295. |
| dependencies | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:78 names 1295 and the consumed/output contract. CLI metadata agrees and whole-batch dependency projection has no cycle. Scheduling status=todo; prerequisites are not claimed done. |
| premises | PASS | docs/tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md:23 records current-source corrections: A concrete duplicated family is now identified: the shared rpc-client mock duplicates fetch timeout/cancellation code and diverges (10s vs 30s, missing pre-abort/reason/listener cleanup). This is no longer blocked on discovering a candidate or on SSE migration. Inspected seams: apps/web/tests/test-helpers/rpc-client-mock.ts:32; apps/web/src/lib/rpc-client.ts:42; apps/web/src/lib/rpc-client.ts:61. Source/test paths checked; new files are explicitly planned. Starting diff preserved; one worktree and five-folder wip inventory recorded. |
