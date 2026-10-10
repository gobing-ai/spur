---
schema_version: 1
name: Stop the full quality gate from failing on load-sensitive test timeouts
status: todo
template: standard
created_at: 2026-10-10T02:48:42.957Z
updated_at: "2026-10-10T02:49:24.014Z"
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

### Requirements

- [ ] R1. **Reproduce the class deterministically.** A load fixture (concurrent CPU/system load, e.g.
  a bounded script that runs N busy processes, or a second suite invocation) under which the current
  suite fails at least one of the four named tests, and under which the fixed suite passes. The
  fixture and its captured output are the task's evidence, not a narrative.
- [ ] R2. **Fix the contention, do not weaken the assertions.** For each victim, choose and record
  one of: (a) an explicit, justified budget where the test's real work genuinely exceeds the
  default; (b) remove the accidental contention in the test itself (unnecessary spawn, serialized
  wait, oversized fixture); (c) bound the host-side concurrency for the spawn-heavy files. Forbidden:
  `.skip`, deleting an assertion, a budget with no measured basis, or any change that lets a genuine
  hang pass.
- [ ] R3. **Every budget change cites the measurement it came from** — the slowest observed duration
  (full-gate runs and isolated runs both), so the margin is derived rather than guessed.
- [ ] R4. **Re-verify under load.** Three consecutive full `bun run spur-check` runs against the load
  fixture all exit 0 with zero test failures; the three logs are stored as evidence.
- [ ] R5. **A real hang still fails.** A seeded indefinite hang in one test still fails the gate,
  proving the bounds were tightened with evidence rather than removed.
- [ ] R6. **No new surface.** No new CLI verb or flag, no new dependency; the change stays inside the
  affected test files (plus a workspace `bunfig.toml` test setting only if R2(c) is chosen).

### Acceptance Criteria

```gherkin
Scenario: AC1 — The class reproduces under the load fixture (req: R1)
  Given the load fixture is running
  When the full "bun run spur-check" suite runs on the pre-fix tree
  Then at least one of the four named tests fails
  And the same test passes in isolation within seconds
```

```gherkin
Scenario: AC2 — The fixed gate is green under the same load (req: R2, R4)
  Given the load fixture is running
  When the full suite runs three consecutive times on the fixed tree
  Then every run exits 0 with zero failing tests
  And no test reports a timeout
```

```gherkin
Scenario: AC3 — A genuine hang still fails the gate (req: R5)
  Given a test seeded with an indefinite hang
  When the full suite runs
  Then the gate exits non-zero and names that test
```

```gherkin
Scenario: AC4 — Every budget is measurement-backed (req: R3)
  Given the changed test files
  When each modified budget is inspected
  Then it cites the slowest observed duration it was derived from
  And each affected test completes inside its budget when run in isolation
```

```gherkin
Scenario: AC5 — No surface or dependency was added (req: R6)
  Given the final diff
  When it is inspected
  Then it touches only test files (and at most one workspace test setting)
  And no CLI verb, flag, or dependency was added
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Classifier first.** The four victims are two different shapes, and only one of them is a budget
problem:

| Victim | Slowest full-gate | Isolated | Reading |
| --- | --- | --- | --- |
| `proof-fingerprint > captures the digest…` | 30 000 ms (hit the cap) | ~4 s for 13 tests | shell-out (git) work; the cap is the default, not a chosen budget |
| `cli-surface > …resolve their own surfaces` | 5786 ms (over 5 s) | 4.99 s | spawns the CLI twice; sits AT the declared budget, so any load tips it |
| `inline-run-trace > --ok and --duration-ms…` | 5242 ms (over 5 s) | 9.89 s for 14 tests | each case spawns a process; the declared 5 s is per-file budget for one case |
| `EnvShellGuardRunner > metacharacters…` | 20 000 ms (hit the cap) | 286 ms | the isolated run is 70× under; this is contention, not work |

So: `EnvShellGuardRunner` is contention (fix the test or its scheduling, not the budget); the two
5 s cases are under-budgeted single cases in a spawn-heavy file (justify a budget); the 30 s case
hit a default nobody chose (state a budget with a measurement behind it).

**Prefer determinism levers, in this order.**
1. Remove accidental contention (e.g. a spawn that can be resolved in-process, a fixture that can be
   reused, a redundant second CLI invocation).
2. Give the file/case an explicit budget derived from R3's measurement.
3. Only if 1–2 cannot hold under load, bound host-side concurrency for the spawn-heavy files
   (workspace `bunfig.toml`), and record why.

**Invariants.** The timeout outcome stays an assertion: after the change, an indefinite hang must
still fail the gate (AC3). No test loses coverage, no assertion is relaxed, no `.skip`. Budgets carry
their provenance in a one-line comment beside the number so the next reader can re-derive them.

**Blast radius.** Test files only (four named victims + any sibling in the same files), plus a
workspace test setting only under lever 3. No production code, no workflow YAML, no public surface.

**Evidence to keep.** The load-fixture script, the pre-fix failure capture, the three post-fix gate
logs, and the seeded-hang failure log — all in the task's Testing section.

### Plan

1. **Write the load fixture first.** A bounded script (e.g. `N` CPU-bound processes for the duration,
   or a second suite invocation) whose intensity makes at least one named victim fail on the current
   tree. Record the pre-fix capture. Do not tune the fixture until a victim actually fails — a fixture
   that cannot reproduce the class proves nothing.
2. **Classify each victim** with two measurements: full-gate duration under the fixture and isolated
   duration. Write both into the task's Testing section.
3. **Fix in the order above** (de-contention → measured budget → concurrency bound), smallest diff per
   victim, budget provenance as a one-line comment.
4. **Verify the class is gone**: three consecutive full `bun run spur-check` runs under the fixture,
   all exit 0; keep the logs.
5. **Prove the bound still bites**: seed an indefinite hang in one test, run the gate, confirm it
   fails and names the test; remove the seed.
6. **Final gate**: `bun run spur-check` once on the final tree, plus each changed test in isolation to
   record the margin (AC4).

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

