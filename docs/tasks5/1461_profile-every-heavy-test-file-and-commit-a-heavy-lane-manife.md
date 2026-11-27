---
schema_version: 1
name: Profile every heavy test file and commit a heavy lane manifest with a drift guard
status: done
template: feature-impl
created_at: 2026-11-27T07:07:41.707Z
updated_at: "2026-11-27T18:57:04.611Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

dependencies: ["1459"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1461. Profile every heavy test file and commit a heavy lane manifest with a drift guard

### Background

Feature H162 (under H16; design `docs/design/heavy-suite-lanes.md` §3.1, §3.3–3.4). `test:heavy` (`package.json:86`) takes ~196–277 s per feature-verify pass as two serial `run-tests` calls: 19 `.heavy.test.` files in one child, then `apps/web/tests/modules/integrations-browser.heavy.test.ts` alone (20 files total). A sandboxed per-file pass on 2026-11-26 showed each Board-building browser file spending ~15 s before Chromium launch fails (Chromium cannot launch in the agent sandbox), so baseline timings must come from an unsandboxed host run. Extends `config/test-lanes.json`, introduced by H161 task 1459. Covers R1, R2.

**Refine corrections (2026-11-26)**
- "Board-build time (from buildBoardToTemp timing)" → `buildBoardToTemp` records no timing (`apps/web/tests/test-helpers/board-build.ts:108-160`) → the profile times one production `astro build` directly and records which files build (6 heavy callers), instead of instrumenting the helper.
- "Add the profiling mode" had no home → it is a `--profile-heavy` flag on 1459's `test-lanes` repository command, not a new entrypoint.
- Shared-resource signals scanned (2026-11-26): no heavy file binds a fixed port (fixture servers and CDP use port 0, `apps/web/tests/test-helpers/cdp.ts:102-103`); timing assertions appear in `integrations-browser`, `a2a-sequence`, `rule-busy`, `db-contention`, `quality-gate-lock`, `fleet-e2e-batch-perf` (ratio assert at `scripts/commands/fleet-e2e-batch-perf.heavy.test.ts:16-19`); `quality-gate-lock` already uses a private `SPUR_GATE_LOCK_DIR` (`plugins/sp/tests/quality-gate-lock.heavy.test.ts:94`).

### Requirements

- [x] R1. `bun scripts/spur-dev.ts test-lanes --profile-heavy` runs each `.heavy.test.` file alone under `bunfig.heavy.toml` (through `run-tests`, so env isolation matches the gate), then the unchanged `bun run test:heavy` once, then one timed production `astro build`, and writes `.spur/run/heavy-profile.json`: per file `{ path, wallMs, pass, fail, skip, exitCode, buildsBoard }`, plus `{ baselineWallMs, baselineExitCode, boardBuildMs, cores, sandboxed, startedAt }`. `sandboxed: true` when Chromium fails to launch; such a receipt is not the baseline.
- [x] R2. `config/test-lanes.json` gains a `heavy` array: every `.heavy.test.` file, repo-relative and sorted, `{ path, lane: "concurrent" | "serial", shares: string[], reason }` with `shares` ⊆ `browser, board-build, cli-spawn, sqlite, gate-lock, timing-sensitive, operator-env`. Rules: any `timing-sensitive` file is serial; `fleet-e2e-batch-perf` and `quality-gate-lock` are serial; doubt → serial.
- [x] R3. The repo-wide drift test fails, naming the file, when a `.heavy.test.` file is missing from `heavy` or `heavy` names a missing file, or a row has an unknown `lane`/`shares` value.

Out of scope: running lanes (1463); the Board seed (1462); changing any heavy test; per-test (sub-file) timing.

### Acceptance Criteria

- [x] R1 — A per-file heavy profile and end-to-end baseline are recorded as a receipt
- [x] R2 — Every heavy file is classified concurrent-safe or serial in a committed manifest guarded against drift

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:20:07.964Z

- Board-build timing: one timed production build in the profile, not helper instrumentation (closed 2026-11-26).
- Profiling entrypoint: `test-lanes --profile-heavy` on the 1459 command (closed; no new `scripts/commands` entry).
- Classification: manual with `reason` anchors, doubt ⇒ serial (closed).
- Sandboxed receipt: kept and labelled; the true baseline is required before 1463 closes (closed).

### Design

**Chosen:** extend the H161 manifest with a hand-classified `heavy` array (one lane SSOT, one drift-guard pattern); the profile is a gitignored receipt cited from Testing. **Rejected:** a second manifest file (two SSOTs); tag comments in test files; auto-classifying heavy files (sharing semantics such as timing ratios are judgment, not a token scan).

**Frozen names**
- `packages/app/src/rules/test-lanes.ts` (from 1459) gains `HeavyLaneEntry { path; lane: 'concurrent' | 'serial'; shares: HeavyShare[]; reason: string }`, `HEAVY_SHARES` const tuple, and `diffHeavyLanes(files: string[], manifest: LaneManifest): LaneDrift[]`. `readLaneManifest` validates `heavy` when present.
- `scripts/commands/test-lanes.ts` gains `--profile-heavy`; the generator still preserves `heavy` byte-for-byte when regenerating `root` (1459 invariant).
- Drift guard: extend `repo-wide-tests/test-lanes-manifest.test.ts` (1459) with the heavy membership/value check.
- Receipt `.spur/run/heavy-profile.json` (shape in R1). Pass/fail/skip are read from Bun's summary lines (`N pass`, `N fail`, `N skip`, `Ran N tests across M files`), which the dots reporter prints per child.

**Classification rules:** `shares` records why; `lane` follows: `timing-sensitive` ⇒ serial; `gate-lock` ⇒ serial unless the file isolates its lock dir and is not timing-sensitive; `operator-env` (e.g. `dsh-executor-e2e`, needs operator credentials) ⇒ serial; `browser`/`board-build`/`cli-spawn`/`sqlite` alone ⇒ concurrent (CDP and fixture servers use port 0; per-launch user-data-dir). Each row's `reason` cites the `path:line` that justified it.

**Execution budget:** one unsandboxed profile (~6 min). Persist the receipt before classifying; if the run is sandboxed, keep the receipt with `sandboxed: true`, classify statically, and record that the baseline is pending in Testing (1463 cannot close without it).

**Anti-patterns:** do not edit heavy tests to make them concurrent-safe here; do not move a file out of `.heavy.test.`; do not copy `~/.dsh` credentials to make `operator-env` files pass.

**Handoff:** 1463 reads `heavy[].lane`/`path` via `readLaneManifest` and compares against `heavy-profile.json` for R3/R4 of that task. Depends on 1459 for the module, manifest file and drift test.

### Plan

1. Write failure modes first in `packages/app/tests/rules/test-lanes.test.ts`: missing heavy file, stale row, unknown lane, unknown share, timing-sensitive row marked concurrent, `root` regeneration preserving `heavy` (R2, R3).
2. Implement the heavy types/validation/diff in `test-lanes.ts` until green.
3. Add `--profile-heavy` to `scripts/commands/test-lanes.ts`; run it on an unsandboxed host; persist `.spur/run/heavy-profile.json` (R1).
4. Classify all 20 files into `heavy` with `reason` anchors (R2).
5. Extend the repo-wide drift test; prove it fails on a removed row, then restore (R3).
6. `bun run test-repo-wide`, focused `packages/app` tests, then `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/rules/test-lanes.ts:38-78` | `HEAVY_SHARES` tuple, `HeavyLane`/`HeavyShare`/`HeavyLaneEntry` types, `FORCED_SERIAL` patterns; `readLaneManifest` validates `heavy` row shape (:170-186). | One manifest SSOT: the heavy classification is hand-judged data, so the reader checks shape and the diff checks meaning. |
| `packages/app/src/rules/test-lanes.ts:194-247` | `diffHeavyLanes(files, manifest)`: missing row, stale row, unknown lane/share, `timing-sensitive` marked concurrent, and the two files forced serial. | R2/R3 — the drift guard must name the file, so value legality is reported by path instead of throwing on an array index. |
| `packages/app/src/index.ts:189-203` | Export the heavy types + `diffHeavyLanes` + `HEAVY_SHARES`. | The repository generator and the repo-wide guard consume the same decision. |
| `packages/app/tests/rules/test-lanes.test.ts:238-320` | 8 heavy failure modes (missing, stale, unknown lane, unknown share, timing-sensitive concurrent, forced-serial pair, legal set, absent section) plus reader shape validation. | R2/R3 pinned before implementation; module stays above the per-file gate. |
| `scripts/commands/test-lanes.ts:96-104,150-175` | `--profile-heavy`: each `.heavy.test.` file alone under `bunfig.heavy.toml` through `run-tests`, then one unchanged `bun run test:heavy`, then one timed production `astro build`; writes `.spur/run/heavy-profile.json` + per-file logs. `checkManifest` now also reports heavy drift. | R1 receipt pair for 1463; the profile goes through the launcher so env isolation matches the gate. |
| `config/test-lanes.json:871-1130` | `heavy` array: all 20 `.heavy.test.` files, sorted, `{path, lane, shares, reason}` — 13 concurrent, 7 serial. | R2 membership; each `reason` cites the `path:line` that justified the lane. |
| `repo-wide-tests/test-lanes-manifest.test.ts:22-45` | The drift guard's `--check` now covers the heavy section too (same invocation, no new test). | R3 without a second guard surface. |
| `.spur/run/heavy-profile.json`, `.spur/run/heavy-profile/*` | Profile receipt: `sandboxed: false`, `baselineWallMs: 278395` (exit 0), `boardBuildMs: 9316`, per-file `{wallMs, pass, fail, skip, exitCode, buildsBoard}`. | The before-half of H162's receipt pair; 1463 compares against `baselineWallMs`. |

**Profile (this host, 10 cores):** all 20 heavy files pass alone (87 assertions, 1 skip, 0 fail); per-file walls sum to 286 s — the 278 s baseline plus 20 launcher starts. Six files build the Board, one production `astro build` takes 9.3 s, so ~56 s of the baseline is board builds that 1462's run-scoped seed removes. The three slowest files (`quality-gate-lock` 57 s, `idea-followup-ledger-e2e` 43 s, `board-runtime-browser` 28 s) are serial by classification, which bounds what 1463 can win from concurrency.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/test-lanes.ts` `profileHeavy` (per-file `run-tests --config=bunfig.heavy.toml`, then `bun run test:heavy`, then one web build, receipt write); receipt `.spur/run/heavy-profile.json` inspected 2026-11-27: `sandboxed:false`, `baselineWallMs:278395`, `baselineExitCode:0`, `boardBuildMs:9316`, `cores:10`, 20 file rows, 0 rows with fail>0 or exitCode≠0. |
| R2 | MET | `config/test-lanes.json` `heavy`: 20 rows, 13 concurrent / 7 serial; membership equals `rg --files -g '*.heavy.test.ts'` (diff empty, 2026-11-27); every serial row carries `timing-sensitive` or `operator-env`, incl. `scripts/commands/fleet-e2e-batch-perf.heavy.test.ts` and `plugins/sp/tests/quality-gate-lock.heavy.test.ts`; shape validated by `packages/app/src/rules/test-lanes.ts:62` (`HEAVY_SHARES`) + `:156`. |
| R3 | MET | `packages/app/src/rules/test-lanes.ts:245` (`diffHeavyLanes`), wired in `--check`; `packages/app/tests/rules/test-lanes.test.ts:268-333` (7 cases, pass 2026-11-27); mutation 2026-11-27: deleting heavy[0] and flipping serve-gateway to concurrent → `--check` exit 1 naming `apps/cli/tests/commands/rule-busy.heavy.test.ts` (missing) and `apps/cli/tests/commands/serve-gateway.heavy.test.ts` (timing-sensitive must be serial); manifest restored, `git diff` clean. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — A per-file heavy profile and end-to-end baseline are recorded as a receipt | MET | command | `jq "{sandboxed,baselineExitCode,n:(.files |
| R2 — Every heavy file is classified concurrent-safe or serial in a committed manifest guarded against drift | MET | test | `repo-wide-tests/test-lanes-manifest.test.ts:28` (pass); heavy mutation proof above |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature H162; design `docs/design/heavy-suite-lanes.md` §3.1, §3.3–3.4; upstream 1459; downstream 1463.
- `package.json:86`; `bunfig.heavy.toml`; `apps/web/tests/test-helpers/board-build.ts:108`; `apps/web/tests/test-helpers/cdp.ts:102-103`.
- `scripts/commands/fleet-e2e-batch-perf.heavy.test.ts:16-19`; `plugins/sp/tests/quality-gate-lock.heavy.test.ts:94`.

### History

- 2026-11-27T17:04:25.649Z todo → wip (system)
- 2026-11-27T17:04:53.942Z wip → testing (system)
- 2026-11-27T17:04:56.246Z testing → done (system)

