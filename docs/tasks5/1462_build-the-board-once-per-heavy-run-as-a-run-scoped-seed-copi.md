---
schema_version: 1
name: Build the Board once per heavy run as a run-scoped seed copied per caller
status: done
template: feature-impl
created_at: 2026-11-27T07:07:41.709Z
updated_at: "2026-11-27T17:11:31.955Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1462. Build the Board once per heavy run as a run-scoped seed copied per caller

### Background

Feature H162 (under H16; design `docs/design/heavy-suite-lanes.md` §3.2). Six heavy files call `buildBoardToTemp` (`apps/web/tests/test-helpers/board-build.ts:108`): `a2a-sequence:204`, `board-base-path:57`, `composed-board-browser:218`, `board-maturity-browser:96`, `integrations-browser:13` (production-shaped) and `board-runtime-browser:66` (`testAdapterDir`). Every build holds `BUILD_LOCK` (`board-build.ts:49`) because `astro build` shares the `.astro` cache, so ~15 s builds serialize (~90 s per heavy run). `board-base-path.heavy.test.ts:90` writes into its build dir, so callers get copies, not a shared path. Covers R3, and R5 for the touched files.

**Refine corrections (2026-11-26)**
- `SPUR_TEST_RUN_ID` + `$TMPDIR/spur-board-seed-<runId>` + launcher cleanup → the launcher already creates a per-run `registryDir` (`scripts/commands/run-tests.ts:96`), exports env paths under it, and removes it in `finally` (`:297-298`) → seed lives at `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed`; the run id and the separate cleanup requirement are dropped (design §3.2 updated).
- The root suite also builds: `apps/web/tests/modules/runtime-distribution.test.ts:58` → under `run-tests` it now seeds + copies once; its assertions are unchanged.

### Requirements

- [x] R1. `scripts/commands/run-tests.ts` adds `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed` to the child env (directory not created up front).
- [x] R2. With that variable set, `buildBoardToTemp()` without `testAdapterDir`, inside the existing build lock, builds the seed if absent (astro build into `<seed>.staging-<pid>`, then rename to the seed path); then, after the lock is released, copies the seed into a fresh `mkdtemp(tmpdir(), 'spur-board-0988-')` dir and returns it. Callers keep owning cleanup; `removeBoardBuild` is unchanged.
- [x] R3. `testAdapterDir` builds, and every call when the variable is unset (direct `bun test`), keep today's behaviour: one fresh build per call.
- [x] R4. A failed seed build leaves no seed (staging dir removed) and throws the existing `board build failed` error; the next caller retries the build.
- [x] R5. No heavy assertion, timeout or skip condition changes.

Out of scope: lane scheduling (1463); caching across launcher runs; changing `withBoardBuildLock`, `packCliTarball` or the lock protocol.

### Acceptance Criteria

- [x] R3 — The browser and board heavy files reuse one Board build per heavy run
- [x] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path

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

| File | Change | Why |
| --- | --- | --- |
| `scripts/commands/run-tests.ts:105-108` | Child env gains `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed` (directory created lazily, never up front). | R1: one seed per launcher run, living exactly as long as the run's registry dir — no second run id, no second cleanup path. |
| `apps/web/tests/test-helpers/board-build.ts:34-41` | `BOARD_SEED_ENV` constant documenting the direction of the contract. | The helper names the variable the launcher sets; no other layer needs to know it. |
| `apps/web/tests/test-helpers/board-build.ts:182-217` | `buildBoardToTemp` seeds when the variable is set and `testAdapterDir` is absent, otherwise keeps one fresh build per call; `ensureBoardSeed` (build into `<seed>.staging-<pid>` under the existing lock, then `renameSync` to publish, staging removed on failure); `copyBoardSeed` (`mkdtemp` + `cp`, outside the lock). | R2/R3/R4: rename is the publish step so no caller sees a half-built seed; the copy keeps `board-base-path` from mutating a shared tree; a failed build leaves no seed, so the next caller retries. |
| `apps/web/tests/test-helpers/board-build.ts:250-269` | `astroBuildInto` extracted from `buildBoardOnce` (adapter injection window + one `astro build` + the existing `board build failed` error), plus `setBoardBuildForTest` seam and `buildImpl` indirection. | The seed rules are decisions about *when* a build happens, so their failure modes are testable without paying 9 s of real build each. |
| `apps/web/tests/modules/board-build-lock.test.ts:135-225` | 4 seed tests: one build per run with private copies (mutating a copy leaves the seed intact), adapter builds never seeded, failed build leaves no seed and the next caller rebuilds, variable unset builds per call. | R2–R4 pinned before implementation. |
| `.spur/run/heavy-profile.json` (1461), `/tmp/board-seed-run1.log` | Evidence: the six board heavy files ran together in one launcher call. | Before: 84.6 s summed per-file (1461 profile). After: 50.6 s for all six in one call, 34 pass / 1 skip / 0 fail — the same assertions as the profile. |

**Why no seed for adapter builds:** `testAdapterDir` output contains the injected proof adapter, and `runtime-distribution.test.ts` fails if a production build ever contains it — seeding that output would poison every later caller.

**Why the copy is outside the lock:** the seed is immutable once renamed, so holding the build lock through a recursive copy would serialize callers for nothing.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/run-tests.ts:105-108` adds `SPUR_TEST_BOARD_SEED_DIR: join(registryDir, 'board-seed')` to the child env; nothing creates the directory (the first builder does, `apps/web/tests/test-helpers/board-build.ts:147`). |
| R2 | MET | `buildBoardToTemp` (`.../board-build.ts:182-192`) seeds when the variable is set and no `testAdapterDir`; `ensureBoardSeed` (`:198-217`) runs inside `withBoardBuildLock`, builds into `<seed>.staging-<pid>` (`:205`), publishes with `renameSync` (`:207`); `copyBoardSeed` (`:226-236`) `mkdtemp`s `spur-board-0988-*` and `cp`s the seed after the lock is released; `removeBoardBuild` untouched (`:272-275`). |
| R3 | MET | `testAdapterDir` and an unset variable both take the unchanged `withBoardBuildLock(() => buildBoardOnce(options))` path (`.../board-build.ts:189-191`); both asserted in `apps/web/tests/modules/board-build-lock.test.ts:196-225`. |
| R4 | MET | Staging dir removed on failure and no seed published (`.../board-build.ts:209-213`), original `board build failed` error preserved (`:255-259`), next caller rebuilds — asserted at `board-build-lock.test.ts:201-215`. |
| R5 | MET | The six board heavy files ran together: 34 pass / 1 skip / 0 fail, identical to the 1461 profile's totals for those files; no heavy file was edited (diff touches only the helper and the launcher). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 | MET | command | `bun scripts/spur-dev.ts run-tests --config=bunfig.heavy.toml test --reporter=dots <six board heavy files>` → 50.6 s, exit 0, 34 pass / 1 skip / 0 fail (summed per-file before: 84.6 s). |
| R5 | MET | test | `apps/web/tests/modules/board-build-lock.test.ts:135-225` (4 seed cases) + the unchanged heavy-file run above. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature H162; design `docs/design/heavy-suite-lanes.md` §3.2; downstream 1463.
- `apps/web/tests/test-helpers/board-build.ts:49,108,117,135-160`; `apps/web/tests/board-base-path.heavy.test.ts:85-90`; `apps/web/tests/modules/runtime-distribution.test.ts:58`.
- `scripts/commands/run-tests.ts:96-115` (registryDir + env), `:297-298` (cleanup).

### History

- 2026-11-27T17:11:05.490Z todo → wip (system)
- 2026-11-27T17:11:29.594Z wip → testing (system)
- 2026-11-27T17:11:31.948Z testing → done (system)

