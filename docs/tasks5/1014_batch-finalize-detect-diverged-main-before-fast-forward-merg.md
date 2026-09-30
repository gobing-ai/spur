---
schema_version: 1
name: "Batch finalize: detect diverged main before fast-forward merge attempt"
status: todo
template: issue
created_at: 2026-09-30T13:44:22.451Z
updated_at: "2026-09-30T14:00:40.110Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1014. Batch finalize: detect diverged main before fast-forward merge attempt

### Background

Filed from the A9 post-batch review (open issue O3). dev-runall `--worktree` finalize assumed fast-forward from the batch branch to main. During A9 (2026-09-29), main moved mid-batch — operator commits at 16:30 (`6a73f692e`, `4add06b6d`, `7b9f03bb6`), 20:23 (`193cf85f8`, `48bf1a8cc`), 22:34 (`8027248e2`) PDT. At finalize (Sep 30 ~00:30) the FF attempt failed and the driver stalled with no guidance; a manual merge session was required (~35 min): 4 conflicts (export union in `packages/app/src/index.ts`, `feature-check.ts` delegate, 2 generated lib bundles needing `bun run --filter '@gobing-ai/spur' build:bundle`), 3 full gate runs, merge commit `1451c856e` (8 task commit SHAs preserved deliberately over rebase so recorded evidence keeps pointing at real commits).

### Requirements

- [ ] R1. Finalize classifies branch state BEFORE any merge attempt: `git merge-base --is-ancestor main HEAD` and the reverse → `fast-forwardable` | `diverged` | `already-merged`; fail closed with a clear message if git checks error.
- [ ] R2. Diverged: do NOT attempt FF; emit a merge plan to the operator — branches + merge-base, conflict forecast via `git merge-tree --write-tree` (graceful fallback if git is too old), the A9 conflict classes to expect (export unions in `packages/app/src/index.ts`, service delegates, generated bundles needing `build:bundle` regeneration, task-file evidence rows), and the merge-commit fallback procedure (`git commit -F <file>`, conventional message + " (A9 Wn)" suffix pattern, no tool-guard-violating flags).
- [ ] R3. Merge plan includes the post-resolution checklist: regenerate lib bundles and include them in the merge commit; run full `bun run spur-check` ONCE after merge (not per conflict).
- [ ] R4. Manifest `.spur/run/worktree-<id>.json` records finalize mode (`fast-forward` | `merge-commit` | `diverged-needs-operator`) alongside existing mergedAt/cleanedUpAt timestamps.
- [ ] R5. Docs updated in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` and `execution-batch.md`: finalize decision tree (FF when ancestor; merge-commit fallback with operator gate; never rebase in finalize by default — preserves evidence SHAs).
- [ ] R6. Unit test for the diverged-main path: synthetic repo with main ahead; asserts classification, merge-plan emission, and that no destructive git ops (rebase/reset/force) are attempted.
- [ ] R7. FF-able and already-merged paths keep current behavior (no regression).

### Acceptance Criteria

- [ ] AC1 — Finalize classifies FF-able vs diverged before mutating git state (req: R1, R7)
- [ ] AC2 — Diverged finalize emits an actionable merge plan with conflict forecast and bundle-regeneration guidance (req: R2, R3)
- [ ] AC3 — Manifest records the finalize mode and timestamps (req: R4)
- [ ] AC4 — Docs decision tree + diverged-path unit test exist and pass (req: R5, R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Locate finalize: `plugins/sp/scripts/inline-run-setup.ts` is thin glue — logic lives in the packages/app lib (moved A9 W3, commit `265e070c4`); edit the lib source.
2. Implement classification (merge-base checks, R1) ahead of the existing merge invocation.
3. Build the merge-plan emitter (R2/R3): merge-tree forecast with graceful degradation; conflict-class hints; regeneration + single-gate checklist.
4. Extend the worktree manifest writer with finalize mode (R4).
5. Unit tests in `packages/app/tests/services/inline-run-driver.test.ts` (or `plugins/sp/tests/task-pipeline-resilience.test.ts` where the harness fits): diverged, FF-able, already-merged (R6, R7).
6. Docs edits (R5). Run `bun run plugin-smoke` (standalone contract) + targeted tests.

### Root Cause

Finalize encoded an optimism assumption — main frozen during the batch — that real operator behavior (parallel main-tree work) violates. With no detection step, the failure surfaced as a stalled FF with zero guidance, converting a mechanical merge into a ~35-minute manual session plus 3 redundant full gates.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Targeted unit tests: diverged (merge plan emitted, no destructive ops), FF-able (unchanged behavior), already-merged (no-op).
- `bun run plugin-smoke` for the standalone plugin contract.
- No full gate until the task boundary; record receipts here.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- A9 merge commit `1451c856e`; manifest `.spur/run/worktree-506b.json` (status merged).
- Interleaved operator commits: `6a73f692e`, `4add06b6d`, `7b9f03bb6` (16:30), `193cf85f8`, `48bf1a8cc` (20:23), `8027248e2` (22:34) 2026-09-29 PDT.
- Tool-guard fact: `git merge` without `--no-edit` is blocked; commit via `git commit -F <file>`.
- Lib move anchor: commit `265e070c4` (A9 W3).

### History
