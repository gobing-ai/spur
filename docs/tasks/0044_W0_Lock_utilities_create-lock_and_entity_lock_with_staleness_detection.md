---
name: "W0: Lock utilities — create-lock and entity lock with staleness detection"
description: "W0: Lock utilities — create-lock and entity lock with staleness detection"
status: Done
created_at: 2026-06-13T01:08:18.980Z
updated_at: 2026-06-13T13:00:00.000Z
folder: docs/tasks
type: task
feature-id: F1
priority: P0
tags: ["rd3-migration","wave-0"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0044. "W0: Lock utilities — create-lock and entity lock with staleness detection"

### Background

Design §4.2, DD-05. H04 — one lock domain, reachable only through PlanningWriteService.


### Requirements

## Requirements

- [x] **R1**: Per-folder create-lock serializing WBS/feature-ID allocation → **MET** | Evidence: `locks.ts:128 acquireCreateLock()`; tests `locks.test.ts:134-150` + contention test
- [x] **R2**: Per-entity lock for read-modify-write → **MET** | Evidence: `locks.ts:109 acquireEntityLock()`; tests `locks.test.ts:31-118`
- [x] **R3**: pid+timestamp staleness with TTL break + warning → **MET** | Evidence: `locks.ts:86 isStale()` (dead-PID + TTL); tests `locks.test.ts:60-97`
- [x] **R4**: Temp names compose project name + WBS/feature id + random suffix (DD-05) → **MET** | Evidence: `locks.ts:202 atomicWrite()` (`.<project>.<entity>.<rand>.tmp`); tests `locks.test.ts:226-237`
- [x] **R5**: Concurrency tests on temp dirs → **MET** (was PARTIAL) | Evidence: contention test (reject-while-held, admit-after-release) + DD-05 fsync durability test added in fix-pass; tests `locks.test.ts` concurrency + atomicWrite blocks
- [x] **DD-05 fsync**: atomic write must temp + fsync + rename → **MET** (was UNMET — code skipped fsync) | Evidence: `locks.ts fsyncPath()` wired into `atomicWrite`/`atomicWriteAsync`


### Q&A



### Design

Authority: design §4.2 (lock domain), DD-05 (atomic write: temp + fsync + rename, temp names compose
project name + entity id + random suffix, e.g. `.spur-new.0042.<rand>.tmp`). Locks: per-folder
create-lock (`<folder>/.create.lock`) serializing WBS/feature-ID allocation; per-entity lock for
read-modify-write; pid + timestamp staleness with TTL break + warning (legacy semantics preserved).

Boundary: the module lives in `packages/domain` and is reachable **only** through
`PlanningWriteService` (design §4.2) — direct imports elsewhere are a review-rejectable violation.


### Solution

1. `packages/domain/src/planning/locks.ts`: `acquireCreateLock(folder)` / `acquireEntityLock(id)`
   returning a disposable release handle; TTL param with default; stale-break emits a warning result the
   caller can surface.
2. Co-locate `atomicWrite(path, content, entityId)` here (DD-05 owns both halves of crash safety):
   temp-in-same-dir naming per DD-05, fsync, rename.
3. File I/O through `@gobing-ai/ts-runtime` FileSystem (H12 — no parallel fs wrapper).
4. Tests `packages/domain/tests/locks.test.ts`: concurrent create allocation yields distinct sequential
   ids and no leftover locks; stale lock broken after TTL with warning; atomicWrite leaves no temp file on
   success or simulated failure. Gate: `bun run check`; ≥90%.


### Plan
1. Created `packages/domain/src/planning/locks.ts` — `acquireCreateLock`, `acquireEntityLock`, `atomicWrite`, `atomicWriteAsync`, `cleanupTempFiles`, `readLockMetadata`, `inspectLock`.
2. Lock files carry `{pid,ts}` metadata. Staleness: dead PID → break; timestamp older than TTL → break. Stale breaks return `staleWarning` in `LockResult`.
3. `atomicWrite` uses temp-in-same-dir naming per DD-05 (`.spur.<entity>.<rand>.tmp`), writes temp via `FileSystem.writeFile`, atomic rename via `node:fs.renameSync` (FileSystem interface lacks `rename`).
4. `FileSystem` accepted as DI parameter (H12 — no parallel fs wrapper).
5. Exported from `packages/domain/src/index.ts` barrel.
6. Tests at `packages/domain/tests/planning/locks.test.ts` — 30 tests covering clean acquire, stale break (dead PID + TTL), release idempotency, release-no-delete-if-content-changed, concurrent allocation, atomic write (content + no leftover temps), async write, cleanup, readLockMetadata, inspectLock.

### Review
## Review — 2026-06-14 (dev-verify --force re-audit of Done task)

**Status:** 4 findings (0 P1, 1 P2, 1 P3, 1 P4 + 1 traceability) — all fixed
**Scope:** `packages/domain/src/planning/locks.ts`, `packages/domain/tests/planning/locks.test.ts`
**Mode:** verify (Phase 7 SECU + Phase 8 traceability), focus=all, fix=all
**Channel:** inline
**Gate:** `bun run lint` clean (7 workspaces) · `bun run test` 738 pass / 0 fail · `locks.ts` 100% func / 99.28% lines

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | DD-05 durability gap: `fsync` missing | Correctness | locks.ts:193, :216 | FIXED — `atomicWrite`/`atomicWriteAsync` documented "temp + fsync + rename" but never fsynced. Added `fsyncPath` helper: fsync temp file before rename + best-effort fsync parent dir after rename, per DD-05 (design line 288). Resolves the doc-vs-code contradiction. |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 2 | `currentPid()` over-engineered | Usability | locks.ts:45 (old) | FIXED — removed the `globalThis` cast helper; module already calls `process.kill` directly, so `process.pid` is used for consistency. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | Unused `Stats` re-export | Usability | locks.ts:291 (old) | FIXED — dead surface; no consumer imports it (workflow-service imports `Stats` from `node:fs` directly). Removed. |

### Traceability follow-ups
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 4 | R5 covered only sequentially; fsync path untested | Correctness | locks.test.ts | FIXED — added a contention test (holder A rejects holder B while held, admits after release) + a DD-05 fsync durability test. 30→33 tests. |

**Fix-pass 2026-06-14:** 4 fixed, 0 failed, 0 skipped. Post-fix re-verdict: PASS.


### Testing
Full suite: `bun run spur-check` — lint clean (7 workspaces), 736 pass / 0 fail.
Pre-check: 21/21 rules pass. Post-check: 2/2 rules pass (coverage-gate + tsdoc-export).
Module coverage: `locks.ts` 100% lines / 100% functions.

### Artifacts
| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| impl | `packages/domain/src/planning/locks.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/planning/locks.test.ts` | main | 2026-06-13 |


### References


