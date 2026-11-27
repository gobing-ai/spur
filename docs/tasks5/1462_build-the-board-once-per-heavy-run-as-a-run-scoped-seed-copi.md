---
schema_version: 1
name: Build the Board once per heavy run as a run-scoped seed copied per caller
status: todo
template: feature-impl
created_at: 2026-11-27T07:07:41.709Z
updated_at: "2026-11-27T07:20:28.002Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

estimate_hours: 4
---

## 1462. Build the Board once per heavy run as a run-scoped seed copied per caller

### Background

Feature H162 (under H16; design `docs/design/heavy-suite-lanes.md` §3.2). Six heavy files call `buildBoardToTemp` (`apps/web/tests/test-helpers/board-build.ts:108`): `a2a-sequence:204`, `board-base-path:57`, `composed-board-browser:218`, `board-maturity-browser:96`, `integrations-browser:13` (production-shaped) and `board-runtime-browser:66` (`testAdapterDir`). Every build holds `BUILD_LOCK` (`board-build.ts:49`) because `astro build` shares the `.astro` cache, so ~15 s builds serialize (~90 s per heavy run). `board-base-path.heavy.test.ts:90` writes into its build dir, so callers get copies, not a shared path. Covers R3, and R5 for the touched files.

**Refine corrections (2026-11-26)**
- `SPUR_TEST_RUN_ID` + `$TMPDIR/spur-board-seed-<runId>` + launcher cleanup → the launcher already creates a per-run `registryDir` (`scripts/commands/run-tests.ts:96`), exports env paths under it, and removes it in `finally` (`:297-298`) → seed lives at `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed`; the run id and the separate cleanup requirement are dropped (design §3.2 updated).
- The root suite also builds: `apps/web/tests/modules/runtime-distribution.test.ts:58` → under `run-tests` it now seeds + copies once; its assertions are unchanged.

### Requirements

- [ ] R1. `scripts/commands/run-tests.ts` adds `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed` to the child env (directory not created up front).
- [ ] R2. With that variable set, `buildBoardToTemp()` without `testAdapterDir`, inside the existing build lock, builds the seed if absent (astro build into `<seed>.staging-<pid>`, then rename to the seed path); then, after the lock is released, copies the seed into a fresh `mkdtemp(tmpdir(), 'spur-board-0988-')` dir and returns it. Callers keep owning cleanup; `removeBoardBuild` is unchanged.
- [ ] R3. `testAdapterDir` builds, and every call when the variable is unset (direct `bun test`), keep today's behaviour: one fresh build per call.
- [ ] R4. A failed seed build leaves no seed (staging dir removed) and throws the existing `board build failed` error; the next caller retries the build.
- [ ] R5. No heavy assertion, timeout or skip condition changes.

Out of scope: lane scheduling (1463); caching across launcher runs; changing `withBoardBuildLock`, `packCliTarball` or the lock protocol.

### Acceptance Criteria

- [ ] R3 — The browser and board heavy files reuse one Board build per heavy run
- [ ] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:20:11.946Z

- Seed location: `<registryDir>/board-seed` via `SPUR_TEST_BOARD_SEED_DIR` (closed 2026-11-26; replaces run id + `$TMPDIR` seed).
- Build-step test seam: the lock test stubs the astro spawn rather than running real builds (closed; real build proof is Plan step 4).

### Design

**Chosen:** lazy seed inside the existing helper, located in the launcher's per-run temp dir, built under the existing lock, copied per caller. **Rejected:** a launcher pre-build step (builds even when no browser file runs; new entrypoint); handing out the seed path (`board-base-path` mutates its dir); a content-hash cache across runs (stale-proof risk); a separate run id + cleanup (duplicates `registryDir`'s lifecycle).

**Frozen names**
- Env `SPUR_TEST_BOARD_SEED_DIR` (set only by `run-tests.ts`; read with `process.env` in the test helper, which is test code).
- `board-build.ts`: `buildBoardToTemp` keeps its signature. Internals: `ensureBoardSeed(seedDir): void` (inside `withBoardBuildLock`; no-op when `existsSync(seedDir)`; else `buildBoardOnce` into staging + `renameSync`), then `copyBoardSeed(seedDir): Promise<string>` (`mkdtemp` + `cp(..., { recursive: true })`) outside the lock.

**Invariants:** freshness is per launcher run (the seed dies with `registryDir`); a caller never sees a partial seed (rename is the publish step, done under the lock); per-caller isolation preserved (copies); all `astro build` calls still go through `withBoardBuildLock`.

**Anti-patterns:** do not seed `testAdapterDir` builds (their output includes the injected proof adapter); do not hold the lock while copying; do not make `removeBoardBuild` aware of the seed; do not touch heavy test files.

**Handoff:** 1463 runs both heavy phases under one launcher, so both share one seed. No dependency on 1459–1461.

### Plan

1. Write failure modes first in `apps/web/tests/modules/board-build-lock.test.ts` (existing cross-process lock test file) using a stubbed build step: unset env ⇒ build per call; set env ⇒ one build then copies; `testAdapterDir` ⇒ never seeded; failed build ⇒ no seed, next call rebuilds; mutating a returned copy does not change the seed (R2–R4).
2. Add `SPUR_TEST_BOARD_SEED_DIR` to the launcher env (R1).
3. Implement `ensureBoardSeed` / `copyBoardSeed` in `board-build.ts` until green.
4. Unsandboxed: run the six board heavy files under one `run-tests --config=bunfig.heavy.toml` call; confirm one production `astro build` (time it) and all files pass as before; record wall time vs. the 1461 profile (R5).
5. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature H162; design `docs/design/heavy-suite-lanes.md` §3.2; downstream 1463.
- `apps/web/tests/test-helpers/board-build.ts:49,108,117,135-160`; `apps/web/tests/board-base-path.heavy.test.ts:85-90`; `apps/web/tests/modules/runtime-distribution.test.ts:58`.
- `scripts/commands/run-tests.ts:96-115` (registryDir + env), `:297-298` (cleanup).

### History
