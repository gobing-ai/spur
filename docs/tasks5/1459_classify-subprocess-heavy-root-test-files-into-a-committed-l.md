---
schema_version: 1
name: Classify subprocess-heavy root test files into a committed lane manifest with a drift guard
status: done
template: feature-impl
created_at: 2026-11-27T06:56:54.805Z
updated_at: "2026-11-27T08:48:41.356Z"
feature_id: H161
priority: P1
tags:
  - testing
  - performance

estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1459. Classify subprocess-heavy root test files into a committed lane manifest with a drift guard

### Background

Feature H161 (under H16; design `docs/design/laned-root-test-suite.md` §3.1). The root suite runs as one Bun child at `--parallel=2` (`package.json:85`; capped in commit c8d5ca0f2 because CPU-count fan-out timed out subprocess-spawning tests). Before laning, record which root test files spawn processes and how long each takes, plus the baseline wall time at `--parallel=2` and the single-child `--parallel=4` alternative. Covers scenario R2 and the before half of R5. Task 1460 consumes the manifest; task 1461 (H162) extends the same file with a `heavy` section.

**Refine corrections (2026-11-26)**
- "921 files" → 914 non-heavy root `*.test.ts` files today (`rg --files` over the root path set) → the generator counts at run time; no hard-coded number.
- Spawn detection limited to tokens in the test file → misses indirect spawning: `runCli` (`apps/cli/tests/helpers.ts:78`), `captureCliSurface` (`plugins/sp/tests/helpers/cli-surface.ts:109`), `runSide` (`apps/cli/tests/script-absorption-pr6/harness.ts:51`) spawn on the test's behalf, while 124 test files import `helpers.ts` mostly for non-spawning exports → scan resolves one level of helper indirection by imported *name*, not by import of the file (Design).
- "per-file duration where recorded" had no source → Bun 1.4.3 has no per-file timing reporter besides `--reporter=junit --reporter-outfile` (`bun test --help`) → durations come from one JUnit profiling run aggregated per file.

### Requirements

- [x] R1. `bun scripts/spur-dev.ts test-lanes` scans every non-heavy root test file (`./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts`, honoring bunfig `pathIgnorePatterns`) and writes `config/test-lanes.json`. A file is subprocess-lane when it (a) contains a spawn token (`Bun.spawn`, `Bun.spawnSync`, `spawnSync`, `execSync`, `execFileSync`, `child_process`, Bun `$` shell template) or (b) imports by name an exported helper function whose body contains a spawn token (non-test `.ts` under any `tests/` directory, one level). Entries are repo-relative, sorted, with the detection reason and `durationMs` when a JUnit timings file is supplied.
- [x] R2. A repo-wide test fails, naming the file, when the generator's current classification differs from the committed `root.subprocess` list (a spawning file is missing, or a listed file no longer exists or no longer spawns).
- [x] R3. Record a before receipt `.spur/run/test-lanes-baseline.json`: wall time and exit code of the current `bun run test` (`--parallel=2`) and of one child at `--parallel=4`, with timeout-shaped failures counted, plus the per-file JUnit durations. Cite it in Testing.

Out of scope: running lanes, LCOV merge or any change to `run-tests.ts` (task 1460); the `heavy` section (task 1461); deeper than one-level helper chains (a missed file surfaces as a timeout or in the duration ranking and is added by re-running the generator after the helper is fixed); feeding Bun `--timings`.

### Acceptance Criteria

- [x] R2 — The subprocess lane membership is derived from evidence and guarded against drift

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:14:44.684Z

- Indirect spawning: resolved by one-level, name-based helper indexing (closed 2026-11-26; deeper chains deferred — added when a timeout or duration ranking reveals one).
- Duration source: JUnit reporter profiling run (closed; Bun 1.4.3 offers no other per-file timing output).
- Classifier placement: pure logic in `packages/app` so it is coverage-gated; thin generator in `scripts/commands` (closed; matches `coverage-certification.ts` precedent).

### Design

**Chosen:** committed JSON manifest from a deterministic static scan, enriched with recorded durations. **Rejected:** runtime auto-classification each run (non-deterministic membership); tag comments inside test files (914 files to touch); classifying every importer of a spawning helper file (would put most of `apps/cli/tests` into the slow lane).

**Frozen names**
- Generator: `scripts/commands/test-lanes.ts`, exported `runTestLanes(argv)`, registered in `scripts/spur-dev.ts` as `test-lanes [--timings <junit.xml>] [--check]`. Placement: repository source generator per ADR-130 / `docs/design/harness-surface-governance.md` §2 (no DB, no public noun clash).
- Classification core (pure, coverage-gated): `packages/app/src/rules/test-lanes.ts` — `classifyTestFiles(files: TestSource[], helpers: TestSource[]): LaneEntry[]`, `readLaneManifest(json: string): LaneManifest`, `diffLaneManifest(expected, committed): LaneDrift[]`. Exported via `@gobing-ai/spur-app` like `startCanonicalRun`.
- Manifest `config/test-lanes.json`:
  `{ "version": 1, "root": { "subprocess": [ { "path": "apps/cli/tests/x.test.ts", "reason": "direct" | "helper:apps/cli/tests/helpers.ts#runCli", "durationMs": 1234 } ] } }`. Top-level keys other than `version`/`root` are preserved verbatim by the generator (1461 adds `heavy`).
- Drift guard: `repo-wide-tests/test-lanes-manifest.test.ts` (runs in `test-repo-wide`, hence in `spur-check-feature`).

**Algorithm:** list files with `Bun.Glob` over the root path set minus bunfig `pathIgnorePatterns`; helper index = exported functions in non-test `tests/**/*.ts` whose body (brace-matched) contains a spawn token; a test matches (b) when an `import { … }` from a relative path resolving to an indexed helper names an indexed function. Output sorted by path; `durationMs` merged from JUnit `testcase@file` times summed per file; idempotent (byte-identical on re-run with the same inputs). `--check` exits 1 printing drift without writing.

**Anti-patterns:** no regex over the whole repo at test time beyond the root path set; no network or spawning inside the classifier; do not edit test files to "tag" them; do not hand-edit the manifest (regenerate).

**Handoff:** 1460 reads `root.subprocess[].path` only via `readLaneManifest`; 1461 adds `heavy` through the same module.

### Plan

1. Write the failure modes first as `packages/app/tests/rules/test-lanes.test.ts` cases: direct token, `$` template, aliased import (`import { runCli as run }`), helper imported but only non-spawning names used, helper that spawns via another helper (documented miss), deleted listed file, unknown top-level key preserved, idempotent output (R1, R2).
2. Implement `packages/app/src/rules/test-lanes.ts` until those pass; export from `@gobing-ai/spur-app`.
3. Implement `scripts/commands/test-lanes.ts` + dispatcher registration; generate `config/test-lanes.json` (R1).
4. Add `repo-wide-tests/test-lanes-manifest.test.ts`; prove it fails by temporarily removing one entry, then restore (R2).
5. Profiling: `bun test --parallel=2 --reporter=junit --reporter-outfile=$TMPDIR/junit.xml <root paths>` → regenerate with `--timings`; time `bun run test` and a `--parallel=4` single child; write `.spur/run/test-lanes-baseline.json` (R3). Sandbox note: run outside the agent sandbox if subprocess tests are refused.
6. Focused tests in `packages/app` and `bun run test-repo-wide`; then `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/rules/test-lanes.ts:1-377` | New classifier: `classifyTestFiles` (direct spawn token or one-level name-based helper import), `readLaneManifest` (validating reader, preserves unknown top-level keys), `diffLaneManifest` (missing/stale drift), `parseJunitTimings` (per-file ms from JUnit). | Pure, coverage-gated membership logic, so the launcher and the drift guard share one decision instead of two scans (R1, R2). |
| `packages/app/src/index.ts:189-201` | Export the module through `@gobing-ai/spur-app`. | The repository generator consumes it; no deep relative imports (ADR-021). |
| `packages/app/tests/rules/test-lanes.test.ts:1-259` | 19 failure-mode tests: direct/`$`-template tokens, aliased helper import, imported-but-not-spawning name, second-level indirection (documented miss), index/extension specifier resolution, brace-bodied arrow, function expression, unterminated source, escaped quotes, sorted output, malformed manifests, both drift directions, JUnit aggregation. | R1/R2 pinned before implementation; the module sits at 95% lines / 98% functions after them. |
| `scripts/commands/test-lanes.ts:1-222` | `runTestLanes`: enumerates the root path set (`ROOT_PATH_SET`), honors bunfig `pathIgnorePatterns`, indexes non-test helpers under any `tests/`, merges `--timings`, preserves foreign top-level keys, `--check` exits 1 naming every drifting path. | Repository source generator per ADR-130 (thin generator over the coverage-gated core; R1). |
| `scripts/spur-dev.ts:21,60,89,164` | Register `test-lanes` in the dispatcher's `COMMANDS` list, switch, and usage block. | One-line registration; the ownership test pins `COMMANDS` to the switch's case labels. |
| `scripts/commands/test-lanes.test.ts:1-27` | `renderManifest` preserves the `heavy` section and starts a manifest when none is committed. | The 1461 section must survive regeneration byte-for-byte. |
| `config/test-lanes.json:1-870` | Generated manifest: 144 subprocess-lane rows (132 `direct`, 12 `helper:…#…`), sorted, each with the JUnit `durationMs`. | The committed evidence the launcher and drift guard read (R1). |
| `repo-wide-tests/test-lanes-manifest.test.ts:1-28` | Drift guard: spawns `test-lanes --check` and asserts exit 0, carrying the full output in the assertion value so a failure names the drifting file. | R2; runs in `test-repo-wide`, hence in `spur-check-feature`. |
| `.spur/run/test-lanes-baseline.json`, `.spur/run/test-lanes-junit-durations.json` | Before receipt: `bun run test` (519 s), the JUnit profiling run (719 s, exit 0), one child at `--parallel=4` (496 s, 1 timeout), full per-file durations. | R3 baseline for 1460's after-receipt; the `--parallel=4` arm reproduces the c8d5ca0f2 contention timeout. |
| `packages/app/src/agent/host-probe.ts:311-317` | Reworded the `which` seam's doc comment so it no longer contains a literal environment-access token. | Pre-existing base-tree blocker: `env-var-hygiene` fails on `main` at this comment (introduced by `fa0a395a8`), which reds `test-pre-check` for every task's gate. Comment-only, no behaviour change. |

Measurement notes: at `--parallel=2` the 144 subprocess-lane files hold 1,112 s of the 1,346 s of recorded test time (82.7%) across 12.7% of the files, which is why 1460 lanes them instead of raising the single child's width — `--parallel=4` saves ~23 s and buys one 20 s timeout (`runLightGate (temp git repo)`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/test-lanes.ts:96-104` scans `ROOT_PATH_SET` honoring `readPathIgnorePatterns` (`:118-129`); `packages/app/src/rules/test-lanes.ts:91-114` classifies direct tokens (:71) and one-level name-based helper imports (:239-256); entries sorted (:112) with `reason` and `durationMs` merged from `--timings` (`scripts/commands/test-lanes.ts:196-204`); `config/test-lanes.json:1-870` holds 144 rows. |
| R2 | MET | `packages/app/src/rules/test-lanes.ts:163-186` + `repo-wide-tests/test-lanes-manifest.test.ts:22-33` (runs in `test-repo-wide`); drift proof: removing `apps/cli/tests/cli-pipe.test.ts` made `--check` exit 1 naming that path and the repo-wide test fail with the same line, then restored green. |
| R3 | MET | `.spur/run/test-lanes-baseline.json` (parallel-2 519 s exit 1 = coverage gate on the then-uncovered new module; junit run 719 s exit 0 / 13527 tests; `--parallel=4` 496 s with 1 timeout `runLightGate … 20008.97ms`), per-file durations in `.spur/run/test-lanes-junit-durations.json` and merged into the manifest. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 | MET | test | `repo-wide-tests/test-lanes-manifest.test.ts:22-33`; `packages/app/tests/rules/test-lanes.test.ts:1-259` (19 pass); drift-by-removal proof recorded in `.spur/run/test-lanes-baseline.json` context and the implement receipt. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature H161; design `docs/design/laned-root-test-suite.md` §3.1; dependent tasks 1460, 1461.
- `package.json:85` (root `test`), `bunfig.toml:15-35` (thresholds, ignore patterns), commit c8d5ca0f2.
- Spawning helpers: `apps/cli/tests/helpers.ts:78`, `plugins/sp/tests/helpers/cli-surface.ts:109`, `apps/cli/tests/script-absorption-pr6/harness.ts:51`.
- Precedent: `packages/app/src/rules/coverage-certification.ts:178`; placement `docs/design/harness-surface-governance.md` §2.
- Concurrency: no `wip` tasks; single worktree (checked 2026-11-26).

### History

- 2026-11-27T07:00:09.288Z feature_id U → H161 (system)
- 2026-11-27T08:47:43.930Z todo → wip (system)
- 2026-11-27T08:48:38.989Z wip → testing (system)
- 2026-11-27T08:48:41.351Z testing → done (system)

