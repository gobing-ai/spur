---
schema_version: 1
name: Stop the full quality gate from failing on load-sensitive test timeouts
status: todo
template: standard
created_at: 2026-10-10T02:48:42.957Z
updated_at: "2026-10-10T03:32:34.908Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1150. Stop the full quality gate from failing on load-sensitive test timeouts

### Background

**Observed 2026-10-09**, during the task-1134 integration gate: three consecutive full
`bun run spur-check` runs each failed on a **different** near-timeout test, and every victim passed in
isolation seconds later.

| Victim | Full-gate result | Isolated result | Budget |
| --- | --- | --- | --- |
| `packages/app/tests/workflow/guards/shell.test.ts` → `EnvShellGuardRunner > a var carrying shell metacharacters cannot execute from a guard` | failed at 20 000.78 ms | 286 ms (file, 8 tests) | bun default 20 s |
| `plugins/sp/tests/helpers/cli-surface.test.ts` → `captureCliSurface live source-local capture > noun and noun+verb captures resolve their own surfaces` | failed at 5786.35 ms | 4.99 s (file, 17 tests) | 5 s declared |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` → `captures the digest into the declared var` | failed at 30 000.96 ms | 3.95 s (file, 13 tests) | bun default 30 s |
| `plugins/sp/tests/inline-run-trace.test.ts` → `--ok and --duration-ms are required and exact: omitted or malformed values are usage errors (exit 2)` | failed at 5242.75 ms | 9.89 s (file, 14 tests) | 5 s declared |

**Impact.** A green gate is currently luck-dependent: each retry re-pays the whole suite (measured
421–838 s of test time, plus a host-wide gate-lock wait of 387 s–35 min), and a load flake looks
exactly like a real failure in the log tail. That ambiguity is the expensive part — during this run
the first flake triggered a rules-level investigation before the timing evidence exonerated it.

**Not this class.** One of the five observed failures was an assertion failure, not a timeout:
`proof-fingerprint > AC5/R5: a digest mismatch names drifted paths` failed because another session
fast-forwarded `main` **into this working tree at 18:51:13 while the suite was running** (its files
were replaced mid-run). That is the 1129 "foreign working-tree change" class, already owned and
closed; it is recorded here only so the two causes are not conflated.

**Relation to closed work.** 1142 (done, H1) removed the *iteration* loop's dependence on the full
gate by adding the light tier. It did not change the full gate's load sensitivity, which is what
this task owns.

**Refinement 2026-10-09 — budget facts corrected against the code.** The table's Budget column was
inverted: the two 20 s/30 s victims run on **declared** budgets, the two ~5 s victims on bun's
**undeclared** 5 000 ms default.

| Victim (current name) | Declared budget | Source |
| --- | --- | --- |
| `shell.test.ts` › `a var carrying shell metacharacters cannot execute from a guard (0435)` | `SPAWN_TIMEOUT_MS = 20_000` | `packages/app/tests/workflow/guards/shell.test.ts:14` |
| `proof-fingerprint.test.ts` › `captures the digest into the declared var` | `slowTest` = `30_000` | `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:14` (landed 29dee6d70, 18:49 on 10-09 — in force during the failing run) |
| `cli-surface.test.ts` › `noun and noun+verb captures resolve their own surfaces` | none → bun default 5 000 ms | `plugins/sp/tests/helpers/cli-surface.test.ts:88` |
| `inline-run-trace.test.ts` › renamed by 1136 (1d4f1a680) to `--ok is required and exact; --duration-ms is optional but malformed values are usage errors (exit 2)` | none → bun default 5 000 ms | `plugins/sp/tests/inline-run-trace.test.ts:198-271` |

Same-file sibling with the identical shape: `inline-run-trace.test.ts:363` "a malformed invocation is a
usage error (exit 2), never a silent emission" — a loop of `runScript` spawns on the bun default. Every
other test in that file already declares `60_000`.

Fresh isolated baseline (2026-10-09 20:28 PDT, host load average 11.7): `shell.test.ts` +
`proof-fingerprint.test.ts` = 22 tests in 1.95 s; `cli-surface.test.ts` + `inline-run-trace.test.ts` =
33 tests in 14.0–19.5 s. All pass.

**What this changes.** Only the two bun-default victims are plausible budget/work problems. The two
declared-budget victims stalled **15–70× past their isolated time** — no measured budget explains
that, so raising them is forbidden by R2 until the load fixture reproduces and diagnoses the stall.

### Requirements

- [ ] R1. **Reproduce the class deterministically.** A load fixture (N busy processes, N =
  2 × `getconf _NPROCESSORS_ONLN`, killed on exit) under which the current tree fails at least one
  named victim. The fixture command and pre-fix capture are recorded in `## Testing`.
- [ ] R2. **Fix the contention, do not weaken the assertions.** Per victim: (a) remove accidental work
  (redundant spawn), then (b) a measured explicit budget. Forbidden: `.skip`, deleting an assertion, a
  budget with no measured basis, raising a declared budget on a victim whose stall is ≥ 5× its
  isolated time, or anything that lets a genuine hang pass.
- [ ] R3. **Every budget change cites its measurement** (slowest full-gate-under-fixture and isolated
  durations) in a one-line comment beside the number.
- [ ] R4. **Re-verify under load.** Three consecutive full `bun run spur-check` runs under the fixture,
  zero failures; logs stored as evidence.
- [ ] R5. **A real hang still fails.** A seeded `await new Promise(() => {})` in one changed test fails
  the gate and names that test.
- [ ] R6. **No new surface.** Test files only (plus at most one workspace `bunfig.toml` test setting);
  no CLI verb/flag, no dependency, no production code.
- [ ] R7. **Declared-budget victims are diagnosed, not padded.** For `shell.test.ts` (0435) and
  `proof-fingerprint` (captures the digest): if the fixture reproduces the stall, record where the time
  goes (spawn wait vs. CPU) and fix that cause; if it does not reproduce in 3 fixture runs, record
  "not reproduced" with the logs and leave the test unchanged.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The class reproduces under the load fixture (req: R1)
  Given the load fixture is running
  When the full "bun run spur-check" suite runs on the pre-fix tree
  Then at least one of the four named tests fails on a timeout
  And the same test passes in isolation
```

```gherkin
Scenario: AC2 — The fixed gate is green under the same load (req: R2, R4)
  Given the load fixture is running
  When the full suite runs three consecutive times on the fixed tree
  Then every run exits 0 with zero failing tests
```

```gherkin
Scenario: AC3 — A genuine hang still fails the gate (req: R5)
  Given a changed test seeded with an indefinite hang
  When the full suite runs
  Then the gate exits non-zero and names that test
```

```gherkin
Scenario: AC4 — Every budget is measurement-backed (req: R3)
  Given the changed test files
  When each new or modified budget is inspected
  Then a comment beside it cites the slowest observed duration it was derived from
```

```gherkin
Scenario: AC5 — No surface or dependency was added (req: R6)
  Given the final diff
  Then it touches only test files (and at most one workspace test setting)
```

```gherkin
Scenario: AC6 — Declared-budget victims are diagnosed or left unchanged (req: R7)
  Given the shell.test.ts 0435 and proof-fingerprint "captures the digest" tests
  When their diff and the Testing section are inspected
  Then each either has a recorded stall cause with a matching fix
  Or is recorded "not reproduced" with logs and has no diff
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-10T03:32:34.087Z

- **Q: Should we raise the 20 s/30 s budgets?** A: No. Both stalled 15–70× past isolated time; a
  budget that absorbs that would also absorb a real hang. R7 diagnoses or leaves them.
- **Q: Bound test concurrency in bunfig?** A: No — the suite is already serial; the contention is
  external host load (load average ~11 from parallel agents). Out of scope.
- **Q: Add a rule banning spawning tests on the bun default budget?** A: Deferred; add only if this
  class recurs after 1150 lands.
- **Q: Run order relative to 1151/1152?** A: Last — its three under-load full gates should run on a
  tree that already contains the other two.

### Design

**Classification (corrected).**

| Victim | Budget | Shape | Lever |
| --- | --- | --- | --- |
| `cli-surface` › `…resolve their own surfaces` | bun default 5 s | 3 cold CLI spawns (`Bun.spawnSync([bun, 'run', apps/cli/src/index.ts, …, '--help'])`, `plugins/sp/tests/helpers/cli-surface.ts:108`); the middle `captureCliSurface()` re-captures the root only to compare `packageVersion` | (a) capture the root once per describe (`beforeAll`) and reuse it in both tests → 2 spawns; then (b) a measured budget |
| `inline-run-trace:198` (renamed) and sibling `:363` | bun default 5 s | 4+ sequential `runScript` spawns each | (b) declare the file's existing `60_000` convention with a measurement comment |
| `proof-fingerprint` › `captures the digest…` | 30 s declared | git shell-out; ~2 s file isolated | R7: diagnose under fixture or leave |
| `shell.test.ts` › 0435 metacharacters | 20 s declared | one `printf` spawn through `NodeProcessExecutor` (execa); ~0.3 s isolated | R7: diagnose under fixture or leave |

**Why lever 3 (bunfig concurrency) is out.** The suite already runs serially in one `bun test`
process (`package.json` `test`), and the host-wide gate lock already serializes full gates — the load
comes from other host processes, which no repo setting can bound. Dropped from scope.

**Invariants.** No assertion relaxed, no `.skip`, budget provenance beside every number, hang still
fails (AC3). The 1129-class assertion failure (`AC5/R5: a digest mismatch names drifted paths`, caused
by a foreign fast-forward into the working tree) stays out of scope.

**Load fixture (scratch, not committed):**

```sh
N=$(( $(getconf _NPROCESSORS_ONLN) * 2 )); pids=""
for i in $(seq $N); do (while :; do :; done) & pids="$pids $!"; done
trap 'kill $pids' EXIT
bun run spur-check 2>&1 | tee "$LOG"
```

### Plan

1. **Reproduce (R1).** Run the fixture with `bun run spur-check` on the pre-fix tree; if no victim
   fails, run the four victim files under the fixture (`(cd plugins/sp && bun test …)`,
   `(cd packages/app && bun test …)`) to get per-file failure. Save the capture.
2. **Measure.** For each victim: isolated duration and duration under fixture → `## Testing` table.
3. **Fix the bun-default victims.** `cli-surface.test.ts`: hoist one root capture; add measured budget.
   `inline-run-trace.test.ts:198,363`: add `60_000` with a measurement comment.
4. **R7 for declared-budget victims.** Only if step 1 reproduced their stall: instrument
   (timestamps around the spawn) to locate the wait, fix that cause. Otherwise record "not reproduced".
5. **Verify.** Three full gates under the fixture (R4); seeded hang (R5) then remove it; final
   `bun run spur-check` without fixture.
6. Commit `test: …load-sensitive budgets (1150)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-10T02:49:15.060Z backlog → todo (system)

