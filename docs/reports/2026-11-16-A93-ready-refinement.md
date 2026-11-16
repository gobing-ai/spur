# A93 ready-depth refinement

Invocation: `sp-dev-refineall --feature A93 --auto --depth ready`.
Batch: `A93-refine-ready-20261116`; source: main@134ea68a111b9d0aac739419a7259d7928498005.
Audit timestamp: 2026-11-16T23:11:19.808Z. State: complete (planning refinement).

Frozen membership/order: 1351 → 1352 → 1353 → 1354 → 1355 → 1356. All were todo; no exclusions,
cycles, out-of-set dependencies, wip tasks or additional worktrees were found. Refinement runs
inline, sequentially in /Users/robin/xprojects/spur-new and preserves existing A93 changes.
No workflow definition exists for this skill-only batch; no workflow run was fabricated.

## Audit findings and decisions

- Eager DB creation in apps/cli/src/index.ts precedes ordinary dispatch; status and install need boot-free routing.
- Decision status currently uses getDb; openExistingDb is not strictly read-only. Its installed adapter enables WAL and creates files. Status must use safe base collectors and report unsupported ledger reads as unavailable. The upstream ts-db owner retains readonly-facade work.
- Global seed helpers treat absent assets as zero writes. Install needs explicit required-asset failure while preserving init semantics.
- Superskill install accepts sp plus --marketplace and default configured targets, without --json. Spur seed timestamp identity cannot be imposed on another tool's adapter rewrite.
- A second compile patch can fail outside the first patch's cleanup scope; nested cleanup and source-root-resolved dependencies are explicit preservation requirements.
- verify-pack currently uses the checkout version and extracts before member validation. The proposed installed contract uses archive package/package.json and pre-extraction safety checks.
- bundle-web auto-builds its default missing web distribution and imports constants from the web workspace. Preserve auto-build and move unchanged transport constants to contracts with a web re-export.

Public contracts remain proposed. This invocation authorizes refinement, not implementation or
host installations. The ready checklist allows explicitly deferred decisions with an owner:
Robin owns concrete public-contract consent before implementation; task 1351 records the scope,
and each public implementation task checks the grant before mutation. Plan readiness never means
that consent was granted. No authorization record is invented.

## Cross-task proposals

No merge is recommended. 1354/1355 share builder registration and a feature scenario but have
different compile-restoration and artifact-integrity boundaries; keep existing 1354 → 1355 order.
1352/1353 share boot routing but own different collectors/seeds; serialize writes to index.ts.
1351/1356 share the ownership report: generate the baseline once, refresh it at final audit rather
than introduce a second inventory mechanism. All tasks already link A93; no relinking is proposed.
No task cancellation, merge or new dependency/toolchain is applied.

## Verification boundary

Quick preflight admitted all six for refine. dependency-drift-check and link-check passed.
Planning changes are written through spur task update only; execution-owned sections remain untouched.
Per-task final checks, digests and seven-row ready evidence are recorded on completion below.
No production code, unit tests, E2E tests, build, install, publish, workflow edit or implementation
verification PASS is part of this refinement operation.

## Batch results

Planning updates are complete. Verdict: **clean**; depth: **ready**. Six tasks refined, 25
correction records, zero task cancellations/merges/drops. Every task remained todo; no transition
was needed. Estimate 1355 changed from 5h to 6h after its integrity/coupling correction; total is 35h.
Ready means a frozen plan with named execution prerequisites, not permission to implement public changes.

| WBS | Outcome | Corrections | Dropped issues | Status | Failed checklist IDs | Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| 1351 | refined / ready | 4 | none | todo → todo | none | 3h |
| 1352 | refined / ready | 4 | none | todo → todo | none | 6h |
| 1353 | refined / ready | 4 | none | todo → todo | none | 8h |
| 1354 | refined / ready | 4 | none | todo → todo | none | 8h |
| 1355 | refined / ready | 5 | none | todo → todo | none | 6h |
| 1356 | refined / ready | 4 | none | todo → todo | none | 4h |

All six `spur task check <wbs> --as todo --json` calls passed without findings. The seven-row
checklist and current planning digest are bound below. Source snapshots confirmed Solution,
Testing and Review unchanged. Existing priorities/dependencies/feature links were preserved.

Machine artifacts: `.spur/run/A93-refine-ready-20261116-{frozen,ready,report}.json`; per-task before,
after and check JSON share that prefix. Historical idea-run evidence is retained unchanged;
this report supersedes its **planning-readiness** assessment without altering that run's receipts.

### Task 1351

Planning digest: `f56ec15c6600ed7c648bd844ea29abe98f90933a3b1cddc6d9b6cedad060390f`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 4 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies [] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: docs/00_ADR.md:2221; scripts/spur-dev.ts:1; docs/design/harness-surface-governance.md:83; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

### Task 1352

Planning digest: `2a0f1b85112513410ef63776624b3ff4813bc091742bbdd319dd6bf6ec8e19b7`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 4 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies ["1351"] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: apps/cli/src/index.ts:135; apps/cli/src/commands/status.ts:36; apps/cli/src/commands/decision.ts:424; packages/domain/src/db.ts:50; packages/app/src/services/project-registry.ts:235; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

### Task 1353

Planning digest: `4320baa40a04471ebdfdb268f4c260e188691f8182e4ae36da2dbe5d96ddcfe5`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 4 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies ["1351"] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: apps/cli/src/index.ts:135; apps/cli/src/commands/init.ts:381; apps/cli/src/commands/init.ts:401; apps/cli/src/commands/init.ts:415; scripts/install.sh:1; scripts/commands/install-sh.test.ts:19; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

### Task 1354

Planning digest: `ddb49b185e9b9705f4c78bc125fa109677b665fdea40db5e7dbea4e32837b801`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 4 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies ["1351"] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: scripts/commands/build-cli.ts:155; scripts/commands/build-binaries.ts:66; scripts/commands/build-server.ts:1; apps/cli/src/index.ts:135; apps/cli/package.json:54; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

### Task 1355

Planning digest: `b326ba26ea8d6bcf656a04d83be0136c8484501e59fde5e04cf23ee9b42f2d46`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 5 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies ["1351","1354"] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: scripts/commands/verify-pack.ts:52; scripts/commands/verify-pack.ts:98; scripts/commands/bundle-web.ts:24; apps/web/src/modules/runtime/manifest.ts:67; scripts/commands/bundle-config.ts:57; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

### Task 1356

Planning digest: `7cbb2c26e64296e50c635f1707c6ef2753c9b32be8bb113e71d1036c8305cacc`.

| Check | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Four observable R-items, explicit scope and no-goals; 4 corrections audited. |
| design | yes | Frozen owning paths, function/verb/output shape, invariants, failure algorithm and dependency handoffs; no app runtime import from CLI/scripts. |
| plan | yes | Ordered steps bind R-items, test-first failing real-CLI proof, repeatable receipt path and named gate; no implementation was executed. |
| ac | yes | Existing feature-linked AC titles retained exactly; task-specific Given/When/Then verification and R-item mapping added without changing feature identity. |
| decisions | yes | Algorithm/ownership choices frozen; public-contract consent explicitly deferred to Robin before dependent public implementation. No approval inferred. Unsupported strict readonly ledger enrichment remains with upstream ts-db owner and reports unavailable. |
| dependencies | yes | Current dependencies ["1351","1352","1353","1354","1355"] match the frozen set and contract handoffs; same-tree shared-file edits serialized. |
| premises | yes | Current tree audited: scripts/commands/workflow-promotion.ts:230; scripts/commands/workflow-promotion.ts:275; scripts/commands/workflow-promotion.ts:302; scripts/commands/workflow-promotion.ts:596; packages/domain/src/analytics/workflow-measurements.ts:313; env dependency/link probes PASS; only main worktree and no wip tasks. Source ask/design artifacts exist. Existing test seams and runtime imports inspected; no build/test claim inferred. |

## Next action and limits

Recommended next command: `/sp:dev-runall --feature A93 --auto`.
The execution intake must resolve Robin-owned public-contract consent before 1352–1355 change
observable contracts, and must begin from a task-isolated tree under project policy. This batch
neither grants that consent nor commits the existing A93 planning diff. The ordered inventory
work in 1351 can produce its audit deliverable independently of the later public grant.

No implementation test/build or feature-completion verification was run. DB-backed status
summaries may report unavailable until the installed upstream facade supports a proven
non-mutating read; this limitation is explicit in 1352, not hidden behind an empty healthy result.

Completed at 2026-11-16T23:12:50.599Z.
