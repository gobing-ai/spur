---
schema_version: 1
name: Run the root suite as two lanes with merged-LCOV threshold gate and prove the wall-time drop
status: cancelled
template: feature-impl
created_at: 2026-11-27T06:56:54.808Z
updated_at: "2026-11-27T19:06:31.261Z"
feature_id: H161
priority: P1
tags:
  - testing
  - performance
  - coverage

dependencies: ["1459"]
estimate_hours: 8
---

## 1460. Run the root suite as two lanes with merged-LCOV threshold gate and prove the wall-time drop

### Background

Feature H161 (under H16; design `docs/design/laned-root-test-suite.md` §3.2–3.4, §4). Uses the manifest from task 1459. `scripts/commands/run-tests.ts:287` runs one Bun child; it must run the subprocess lane at the forwarded `--parallel` bound and the in-process lane at `availableParallelism()`, merge LCOV, apply the bunfig per-file thresholds (`bunfig.toml:15`) to the merged result, and keep the task-1203 certification contract (`run-tests.ts:257-296`). Covers R1, R3, R4, R5 (after), R6.

**Refine corrections (2026-11-26)**
- "union of DA/FN hits" → Bun 1.4.3 LCOV carries only `TN/SF/FNF/FNH/DA/LF/LH` records, no `FN`/`FNDA` (checked against a `.coverage` LCOV: 105 SF, 0 FN lines) → lines merge exactly by summing `DA` per line; functions merge as `FNH = max(laneFNH)` over a shared `FNF`, a sound lower bound (never passes a file a single-child run would fail; may report a false breach when two lanes cover disjoint functions of one file). Plan step 2 measures this.
- "single call site in package.json" → three scripts forward the root path set: `test` (`package.json:85`, `--parallel=2`), `test:coverage` (`:89`) and `test:full` (`:95`), the last two without `--parallel` → subprocess-lane width = forwarded `--parallel` value, default 2.
- "honoring coveragePathIgnorePatterns" in the launcher → Bun already omits ignored paths from LCOV (0 `scripts/`, `.tsx` or `tests/` SF records in the sample) → each lane's config copy keeps `coveragePathIgnorePatterns`; the launcher does not re-implement it.
- Certification reads `<start.coverageDir>/lcov.info` (`packages/app/src/rules/coverage-certification.ts:238`) → the merged report is written exactly there; lane reports live under the launcher's temp `registryDir`.

### Requirements

- [ ] R1. When the forwarded positional args equal the root path set (`./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts`, order-insensitive) and `config/test-lanes.json` lists ≥1 subprocess file, the launcher spawns two concurrent Bun children, each under the existing heartbeat/watchdog with its own coverage dir: subprocess lane = the manifest files at the forwarded `--parallel` (default 2); in-process lane = the root path set with those files added to `pathIgnorePatterns`, at `--parallel=<os.availableParallelism()>` (override `SPUR_TEST_INPROC_PARALLEL`, positive integer, else error). Every other invocation (targeted paths, `--config=bunfig.heavy.toml`, empty manifest) runs today's single child unchanged.
- [ ] R2. Both lane config copies drop `coverageThreshold`; after both children exit, the launcher merges the lane LCOV files per `SF` record and fails nonzero listing every `file metric actual<required` breach of the bunfig line/function threshold. A missing lane LCOV after a 0 exit is a failure, not an empty report.
- [ ] R3. `--publish-coverage` certifies the merged `<coverageDir>/lcov.info` only when both lanes exit 0, the merged gate passes and the tree is unchanged (existing `certifyCanonicalRun`, unmodified).
- [ ] R4. After receipt: laned `bun run test` wall time ≤250 s, and three consecutive laned runs exit 0 with no timeout-shaped failure; per-lane wall times in `.spur/run/test-lanes-timing.json`, the 3-run receipt beside the 1459 baseline, cited in Testing.

Out of scope: manifest generation (1459); heavy-suite lanes (H162 / 1463); changing coverage thresholds or certification semantics; per-file `--timings` scheduling; N-way sharding.

### Acceptance Criteria

- [ ] R1 — The launcher runs the root suite as a subprocess lane and an in-process lane
- [ ] R3 — Coverage thresholds are evaluated on the merged result of both lanes
- [ ] R4 — Canonical coverage certification still publishes only on a fully green unchanged-tree run
- [ ] R5 — A wall-time receipt shows the main suite at or under 250 seconds
- [ ] R6 — Three consecutive laned runs complete with no new timeouts

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:16:06.321Z

- Function-coverage merge: `FNH = max` across lanes (closed 2026-11-26; Bun LCOV has no per-function records). A measured false breach escalates through the implement escalation hop rather than weakening the gate.
- Lane width without `--parallel`: default 2 for the subprocess lane (closed; matches the proven bound).
- Concurrent output: inherited stdio plus a per-lane summary line (closed; no output multiplexer).
- Lane failure policy: run both to completion, first nonzero exit wins (closed).

### Design

**Chosen:** two concurrent children inside the existing launcher; merge + gate in a coverage-gated app module. **Rejected:** N-way sharding (same merge cost, no contention control); raising `--parallel` only (reintroduces c8d5ca0f2 timeouts; kept only if the 1459 baseline at `--parallel=4` beats laning — report that comparison in the receipt).

**Frozen names**
- `packages/app/src/rules/coverage-lanes.ts`, exported through `@gobing-ai/spur-app`:
  - `mergeLcov(reports: string[]): string` — per `SF`: `DA` hits summed per line; `LF` = distinct DA lines, `LH` = lines with hits > 0; `FNF` = max across lanes (equal in practice), `FNH = max(laneFNH)`; files present in one lane copied as-is; output sorted by `SF`, each record ends `end_of_record`, `TN:` kept empty. Throws on an incomplete record.
  - `evaluateCoverageThresholds(lcov: string, threshold: { lines: number; functions: number }): CoverageBreach[]`; `interface CoverageBreach { file: string; metric: 'lines' | 'functions'; actual: number; required: number }`. `LF = 0` or `FNF = 0` → that metric passes (matches Bun's per-file gate).
- `scripts/commands/run-tests.ts`: `ROOT_PATH_SET` constant; `runSuiteChild` reused per lane unchanged (watchdog applies per lane); lanes started with `Promise.all`; lane dirs `<registryDir>/lane-subprocess`, `<registryDir>/lane-inproc`; merged report written to the existing `coverageDir`.
- Env `SPUR_TEST_INPROC_PARALLEL` read via `getEnvVar` (`@gobing-ai/spur-config`, already imported at `run-tests.ts:39`).
- Receipt `.spur/run/test-lanes-timing.json`: `{ lanes: [{ name, files, parallel, wallMs, exitCode }], mergedBreaches, startedAt }`.

**Exit precedence:** first nonzero lane exit code wins; else 1 on breaches; else certification result (as today). On a lane failure the other lane still runs to completion (no early kill), so the full failure set is reported.

**Output:** both children keep `stdio: inherit`; dots interleave, Bun prints each child's failure summary at its end. The launcher prints one `run-tests: lane <name> exit=<n> wall=<mm:ss>` line per lane to stderr.

**Fallback:** if the subprocess lane still times out under concurrency in the 3-run proof, run lanes sequentially (in-process first) behind the same code path. Record the choice in Solution; R4 still applies.

**Anti-patterns:** do not re-implement `coveragePathIgnorePatterns`; do not touch `certifyCanonicalRun`; do not lower thresholds or add ignore patterns to make the merged gate pass; do not parse dots output; do not add `--bail` to one lane.

**Dependencies:** assumes 1459's `readLaneManifest` and `root.subprocess[].path`; leaves the launcher lane loop reusable for 1463 (heavy phases call the same `runSuiteChild`, coverage off, no merge).

### Plan

1. Write failure modes first in `packages/app/tests/rules/coverage-lanes.test.ts`: overlapping SF with disjoint DA hits, file in one lane only, FNF/FNH max rule, LF=0 / FNF=0, incomplete record throws, breach list names file + metric, empty lane string (R2).
2. Implement `coverage-lanes.ts` until green. Equivalence check: on the current tree run one single child with coverage and evaluate its LCOV with `evaluateCoverageThresholds`; result must equal Bun's own gate outcome. Then run the two lanes, merge and compare the breach set; any extra (false) function breach is recorded and escalated, not suppressed (R2).
3. Wire lanes into `run-tests.ts` (`ROOT_PATH_SET`, manifest read, two config copies without `coverageThreshold`, `Promise.all`, merge, gate, existing certification) (R1, R3).
4. Prove non-lane paths are unchanged: `bun run test-repo-wide` and a targeted `(cd apps/cli && bun test tests/output-envelope.test.ts)` still run one child (R1).
5. Run `bun run test` three times consecutively (outside the agent sandbox if subprocess tests are refused); write the 3-run receipt and `.spur/run/test-lanes-timing.json` next to `.spur/run/test-lanes-baseline.json` (R4).
6. `bun run spur-check`.

### Solution

**No code shipped — the task's premise is falsified by measurement (operator decision 2026-11-27: park H161 laning, keep 1459's evidence, continue H162).**

| File | Change | Why |
| --- | --- | --- |
| `scripts/commands/run-tests.ts` | No net change (lane wiring implemented, measured, then reverted). | The two-lane split does not reduce wall time: it re-cuts the same work, and the subprocess lane's 144 files are latency-bound rather than core-bound. |
| `packages/app/src/rules/coverage-lanes.ts` | Implemented (`parseLcov` / `mergeLcov` / `evaluateCoverageThresholds`, 10 tests green at 90.9% funcs / 100% lines), then removed with the launcher revert. | A merge gate with no lane to merge is dead code and a per-file coverage liability. |
| `.spur/run/test-lanes-baseline.json`, `.spur/run/lane-measurements/*` | Measurement receipts: baseline, four laned runs, one isolated subprocess-lane run. | The negative result is the deliverable; 1459's manifest stays as the classification evidence any future plan needs. |

**Measured (this host, 10 cores, load1 ~13–16):**

| Configuration | Wall | Result |
| --- | --- | --- |
| single child `--parallel=2` (baseline) | 519 s | green |
| lanes: sub `--parallel=2` + inproc `--parallel=10` | 501 s | 24 in-process timeouts, 170 merged coverage breaches |
| lanes: sub `--parallel=4` + inproc `SPUR_TEST_INPROC_PARALLEL=6` | 356 s | 23 in-process + 1 subprocess timeout, 168 breaches |
| subprocess lane **alone** `--parallel=4` | 286 s | green, 0 fail |
| in-process lane **alone** `--parallel=10` | 165 s | green |

**Conclusion.** The 144 subprocess-lane files hold 3,959 tests at ~126 ms each — 96% of the suite's wall time — and their time is spent waiting on spawned children, so file width is their only lever: width 2 = 499 s, width 4 = 286 s. Two concurrent suites oversubscribe 10 cores and starve the in-process lane into timeouts, which is what the merged coverage breaches are a symptom of. Reaching R4's 250 s needs the subprocess lane ~13 files wide, which the c8d5ca0f2 timeout constraint forbids; the measured floor for any lane configuration here is ~345 s (in-process 165 s + subprocess@8 ~180 s, sequential, unverified). R4/R5's "≤250 s with three green runs" is therefore unattainable on this hardware at any width, and the operator chose not to re-baseline the AC.

**Follow-up (not this task):** the real lever is per-test child cost in the 144 spawn-heavy files (`spur` CLI startup ~100–300 ms × 3,959 tests), not scheduling. Recorded for H161's re-scope.

Cancelled 2026-11-27 (operator decision: re-scope H161 to R2). Premise falsified by the measurements in Solution; the per-test spawn-cost lever is tracked in task 1475.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature H161; design `docs/design/laned-root-test-suite.md` §3.2–3.4, §4; upstream 1459; downstream 1463 (H162).
- `scripts/commands/run-tests.ts:182` (`runSuiteChild`), `:257-296` (canonical window), `:284-287` (config copy).
- `packages/app/src/rules/coverage-certification.ts:178`, `:215`, `:238`.
- `package.json:85,89,95`; `bunfig.toml:8-35`.

### History

- 2026-11-27T07:00:09.288Z feature_id U → H161 (system)
- 2026-11-27T16:48:53.202Z todo → blocked (system)
- 2026-11-27T19:06:15.757Z blocked → cancelled (system)

