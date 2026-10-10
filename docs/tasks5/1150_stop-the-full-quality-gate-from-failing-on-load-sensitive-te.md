---
schema_version: 1
name: Stop the full quality gate from failing on load-sensitive test timeouts
status: todo
template: standard
created_at: 2026-10-10T02:48:42.957Z
updated_at: "2026-10-10T16:24:29.821Z"
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

**Refine corrections (2026-10-10)**
- Rechecked all four cited test files: 20s/30s declared wrappers and the two default-budget spawn loops still exist. Historic timing/session logs were not recovered; treat those numbers as reported observations, not fresh reproduction.
- Busy-loop fixture was called deterministic, used a Linux-specific CPU query and a tee pipeline that could return success after gate failure → freeze portable CPU discovery, owned-child cleanup and captured gate exit below; reproduction remains an outcome to measure.
- Repeated full gates had no execution bound and mixed foreign-tree drift with timeout contention → cap fixture attempts, retain each log/exit and explicitly stop with not-reproduced evidence rather than inventing a cause.
- Q&A's ordering after 1151/1152 was undeclared and unrelated to their product behavior → remove that prerequisite; 1154 owns gate topology, so serialize its implementation and take the final gate measurements after its changes when both are being delivered.

### Requirements

- [ ] R1. **Measure and reproduce the reported class.** A portable load fixture (N owned Bun busy-loop processes, N = 2 × availableParallelism(), terminated and awaited on exit) seeks a timeout in a named victim, with at most three pre-fix attempts and a 90-minute experiment budget. If no victim reproduces, record not reproduced and do not claim this requirement MET. The fixture command and pre-fix capture are recorded in `## Testing`.
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

- Closed: preserve the 20s/30s budgets unless a reproduced stall has a test-local cause; no speculative padding.
- Closed: use portable owned-child load generation and retain the gate's actual exit status.
- Closed: no logical prerequisite on 1151/1152. Serialize overlapping gate work with 1154; remeasure against the final composition.
- Closed: three pre-fix attempts and a 90-minute experiment budget; if no timeout reproduces, record not reproduced and leave that victim unchanged rather than manufacture a fix.

### Design

**Chosen change / owners.** Test-only work in plugins/sp/tests/helpers/cli-surface.test.ts and plugins/sp/tests/inline-run-trace.test.ts; the shell and proof-fingerprint test files change only for a reproduced, localized stall. No new API, dependency, production setting, or blanket test timeout. The current root bunfig enforces per-file 90/90 coverage; keep it intact. The helper's noun/verb case cold-spawns root just to compare version; capture root once in a describe-scoped beforeAll with an explicit measured hook timeout and retain its sorted commands/version assertions. The two trace usage-error tests each spawn four scripts without an explicit budget; use their file's existing 60_000 convention only if the measurements justify it, with the R3 provenance comment.

**Load experiment.** Use a temporary Bun driver with availableParallelism() from node:os (or cpus().length fallback), start exactly 2× that number of owned Bun subprocesses running a busy JS loop, and keep their handles. Spawn the source-local gate with stdout/stderr redirected to a unique log; await and preserve its exit status. In finally terminate and await only those load-child handles. No broad pkill, no process-group guessing, no tee masking exits, no mutations in another session's tree. Record CPU count, load count, Bun version, SHA, lock wait separately from test runtime, victim name/duration and timeout. Gate-lock waiting is not test timing.

**Bounded procedure.** At most three pre-fix fixture attempts, then three post-fix full gates under the identical fixture, one unloaded final gate. Set a 90-minute wall-clock experiment budget, preserve partial logs under .spur/run/1150-load-<attempt>.log, and stop as not-reproduced/verification incomplete on exhaustion; do not claim R1/R4 MET. An inability to reproduce is an honest execution outcome, not permission to pad declared budgets. Record separate isolated named-test and fixture named-test durations, retaining the full gate evidence required by R4. Declared-budget stalls ≥5× isolated remain unchanged unless timestamps localize a fix that stays within test scope; a production executor problem is a separate follow-up, never silently absorbed.

**Hang check.** Temporarily seed an asynchronous never-resolving await in one changed async test; run its named test with the selected finite timeout first, then the full gate as R5 requires, record nonzero/named failure and restore exact source in finally. Do not hang a synchronous spawn without a separate outer process deadline. No skipped tests/assertions, lowered coverage or retries-as-success.

**Sibling boundary.** 1154 owns default gate composition, caching and coverage aggregation; 1160 owns sensitive-path parsing. This task owns only measured test-work/budget changes. They are not prerequisites to understanding this spec; serialize changes in overlapping test files and remeasure when gate topology changes. 1142 is historical light-tier context, not a new dependency. No downstream handoff or public surface change.

### Plan

1. [ ] R1/R7: save source SHA, ownership and four victim budgets; build only a temporary load driver as specified in Design, preserve exit codes/owned-child cleanup and run at most three pre-fix attempts within the budget. Record isolated versus loaded named-test timings and separate gate-lock waits.
2. [ ] R2/R3: cache the describe's live root capture; remove no assertions. Add finite measured budgets only to the unbudgeted trace/helper cases, including a measured beforeAll hook limit.
3. [ ] R7: localize reproduced declared-budget stalls with spawn-versus-CPU timestamps; make a test-local fix or retain unchanged/not reproduced with logs.
4. [ ] R4: run three full gates under the same fixture on the fixed tree, preserving each status/log. Do not retry away failures or exceed the experiment budget.
5. [ ] R5: seed one async hang, prove named nonzero failure, restore source in finally; then run the focused victim suites and one unloaded full gate.
6. [ ] R6: inspect test-only scope and unchanged coverage, perform pipeline review/verify/record and commit. Retain partial evidence and report unmet AC on exhaustion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 4.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T02:49:15.060Z backlog → todo (system)

