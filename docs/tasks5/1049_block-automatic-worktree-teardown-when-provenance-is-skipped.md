---
schema_version: 1
name: Block automatic worktree teardown when provenance is skipped for an external-key conflict
status: done
template: issue
created_at: 2026-10-02T05:46:44.406Z
updated_at: "2026-10-02T11:01:56.479Z"
feature_id: E71

priority: P2
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1043", "1045"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-run-1049-e7e0/.spur/memory/evidence/1049-verdict.json
---

## 1049. Block automatic worktree teardown when provenance is skipped for an external-key conflict

### Background

Both worktree cleanup exports returned ok true while reporting external-key-conflict. The retained receipts are .spur/memory/runs/worktree-cleanup-20261002/spur-new-run-1046-5da7-persist.json and spur-new-verify-e71-persist.json. Source runs run_7aa524ae-870c-4610-a17a-01e58980a227 and run_42bb7681-327b-46f6-95e5-c8ad612350cc had unique transitions, state rows and task links that did not enter main. Cleanup preserved them by separately archiving all 332 local files plus consistent SQLite snapshots before deletion; the canonical receiving run was left intact.

packages/domain/src/dao/run-transfer.ts:14 intentionally skips the conflicting source run; packages/app/src/services/inline-run-setup.ts:1354 makes only record-conflict a teardown failure. The execution-batch WT-4 contract treats a green delegate as sufficient for automatic deletion. Without the separate archive used here, that path can discard skipped history. Keep the low-level exclusion tested by task 1045; fix high-level success semantics, not the conflict policy. Canonical verdict divergence was safely reconciled after archival and is not itself a bug. Task 1046's prose correction is already applied and excluded. These are task-local retention regressions under E71.

Direct triage repair also copied the cleanup archive out of disposable scratch into the retained run plane: all 347 copied files, the original 332 source files and both SQLite snapshots were verified. This task addresses the remaining automatic-teardown semantics, not that completed data-preservation repair.

### Requirements

- [x] R1. The persist-out delegate must return ok false/nonzero on any external-key-conflict skip and name the skipped source run IDs and the requirement to retain the source worktree.
- [x] R2. Preserve the domain skip policy and receiving canonical evidence; never overwrite, merge run identities, backfill children into another run, or copy excluded records as if they belong to it.
- [x] R3. Update the existing worktree teardown contract to stop before worktree/branch removal on that result. Explain bounded manual reconciliation: consistent source DB/file archive with hash verification before operator-authorized cleanup, as demonstrated by the retained cleanup manifest.

### Acceptance Criteria

- [x] AC1 — Conflict prevents automatic teardown (req: R1, R3).
  Given a source bookkeeping run with an external key already owned by a different receiving run, when the shared delegate persists it, then exit is nonzero, ok is false, the source ID is reported and WT-4 does not remove the worktree or branch.
- [x] AC2 — Canonical receiving ownership is unchanged (req: R2).
  Given differing source records and unique children, the domain transfer still reports exclusion and does not attach them to the receiving run or overwrite its files.
- [x] AC3 — Normal and idempotent exports stay successful (req: R1, R2).
  Given no external-key conflict, normal export and id-exists replay repair pass; record-conflict and malformed evidence still retain their existing failure behavior.
- [x] AC4 — Manual reconciliation is auditable (req: R3).
  The worktree contract names the original archived DB snapshot, source run identities, file hash check and verification of merged commit ancestry before explicit cleanup, while retaining strict canonical evidence handling.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T05:46:48.415Z

External-key-conflict is different from id-exists: source and target run IDs differ, and source provenance was not transferred. Default teardown must refuse. Manual cleanup remains possible under explicit operator authorization after archival and verification; there is no new bypass or automatic archive subsystem.

### Design

Keep persistWorktreeRuns and transferRunTables' result shapes and intentional external-key exclusion intact. Extend the existing runInlineRunPersistOut teardown guard beside record-conflict to reject external-key-conflict, include the source IDs in the JSON error and use the current nonzero failure channel. Add no public CLI surface, archive service, force switch or automatic canonical conflict resolver.

Targets: packages/app/src/services/inline-run-setup.ts; packages/app/tests/services/inline-run-driver.test.ts; plugins/sp/skills/spur-dev/references/execution-batch.md; existing plugin trace/standalone tests as needed. Regenerate plugins/sp/lib/inline-run.generated.mjs through build:bundle; do not hand-edit the twin. Read the domain tests under task 1045 to preserve exclusion behavior.

This is deliberately a refusal with existing manual recovery, not a new archive implementation. The cleanup performed in this session demonstrates the recovery and stores the manifest and integrity-checked snapshots under .spur/memory/runs/worktree-cleanup-20261002. No source deletion is allowed merely because a skip was reported as ok at the lower layer.

Manual archives must live outside disposable scratch, under an existing retained plane or an operator-owned backup. The verified retention-receipt.json maps original archived paths to the retained copy. Never treat an archive still inside the tree being discarded as completed retention.

### Plan

1. Add a delegate-level fixture regression with different source/receiving run IDs sharing one external key and unique source children.
2. Extend only the high-level teardown guard and assert receiving rows/files remain unchanged.
3. Clarify WT-4/WT-5 and manual archival reconciliation, preserving the domain-level 1045 test expectations.
4. Regenerate the bundle via its owner; run focused app/plugin/domain tests, deterministic twin parity, the task gate and normal verification.

### Root Cause

The domain transfer accurately reports skipped provenance, but the high-level persist-out delegate converts that report into teardown-safe ok true. A different source run sharing a live receiving external key is not an idempotent copy and cannot be represented by the receiving row's evidence.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/inline-run-setup.ts:1355` |
| `packages/app/tests/services/inline-run-driver.test.ts:468` |
| `packages/app/tests/services/inline-run-driver.test.ts:6` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:251` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:1359-1366` — delegate filters `external-key-conflict` skips, emits `{"ok":false,"error":"persist-out: external-key conflict for source runs <ids>; retain the source worktree and reconcile provenance before teardown"}` and `return 1` (nonzero). Regression `packages/app/tests/services/inline-run-driver.test.ts:503-505` asserts the error names the skipped source run (`run_1049s`), contains "retain the source worktree", and reports `{id:'run_1049s', reason:'external-key-conflict'}` in `skipped`. |
| R2 | MET | `packages/domain/src/dao/run-transfer.ts` untouched by the diff — external-key exclusion intact (`run-transfer.ts:16,33,123`); preserved domain tests `packages/domain/tests/dao/run-transfer.test.ts:115` and `:138` pass 4/0. Driver test `packages/app/tests/services/inline-run-driver.test.ts:509-517` asserts the receiving run count stays `1` and no source record files land in the target — no overwrite, merge, backfill, or misattributed copy. |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:533` — external-key-conflict "fails the pass (1049)": delegate exits 1, names skipped source run ids, source worktree stays provenance owner of record; nonzero persist-out routes to WT-5 (worktree + branch retained) per `plugins/sp/skills/spur-dev/references/execution-batch.md:538-539` and WT-4a guard `:879-883`. Bounded manual reconciliation named in the same sentence: archived DB snapshot, source run identities, file-hash verification, merged-commit ancestry check, residual deletion only as operator-authorized cleanup under strict canonical evidence rules. Design doc aligned at `docs/design/disposable-run-storage.md:55`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Fresh run `bun test packages/app/tests/services/inline-run-driver.test.ts` → 14 pass / 0 fail: `packages/app/tests/services/inline-run-driver.test.ts:468-523` asserts exit 1 (:501), `ok:false` (:502), source ID reported (:503,505) with receiving tree seeded as a different run owning the same external key (:477-491); teardown refusal enforced by WT-4a nonzero→WT-5 contract (`plugins/sp/skills/spur-dev/references/execution-batch.md:879-883`, static-ref). |
| AC2 | MET | test | `packages/app/tests/services/inline-run-driver.test.ts:509-517` — receiving rows unchanged (`COUNT(*)` = 1), source records absent from target; `bun test packages/domain/tests/dao/run-transfer.test.ts` → 4 pass / 0 fail including `packages/domain/tests/dao/run-transfer.test.ts:115-126`. |
| AC3 | MET | test | Driver 14/0 retains record-conflict refusal (`packages/app/tests/services/inline-run-driver.test.ts:434`) and fail-closed unusable-source (`:525`); domain 4/0 retains `id-exists` replay (`packages/domain/tests/dao/run-transfer.test.ts:93`) and idempotent re-persist (`:138`) — success path exit 0 / `ok:true` unchanged (`packages/app/src/services/inline-run-setup.ts:1368-1369`). |
| AC4 | MET | test | `plugins/sp/skills/spur-dev/references/execution-batch.md:533` names all four required elements: original archived DB snapshot, skipped source run identities, file-hash verification, merged-commit ancestry of the source branch, plus explicit operator-authorized cleanup "under the strict canonical evidence rules above". Executable evidence: contract pin `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:251-265` asserts all six AC4-element phrases against the shipped spec (each unique, count=1 — element drops fail); fresh run 35 pass / 0 fail. Corroborated by `docs/design/disposable-run-storage.md:55`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- packages/domain/src/dao/run-transfer.ts:14
- packages/app/src/services/inline-run-setup.ts:1354
- plugins/sp/skills/spur-dev/references/execution-batch.md:516
- .spur/memory/runs/worktree-cleanup-20261002/manifest.json
- .spur/memory/runs/worktree-cleanup-20261002/evidence-reconciliation.json
- Tasks 1043/1045; E71.

### History

- 2026-10-02T10:03:56.702Z todo → wip (system)
- 2026-10-02T11:00:40.419Z wip → testing (system)
- 2026-10-02T11:01:56.476Z testing → done (system)

