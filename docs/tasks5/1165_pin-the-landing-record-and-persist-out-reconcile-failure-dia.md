---
schema_version: 1
name: Pin the landing-record and persist-out reconcile failure diagnostics
status: done
template: feature-impl
created_at: 2026-10-10T16:02:04.236Z
updated_at: "2026-10-10T23:56:14.262Z"
feature_id: E71

ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1148", "1149"]
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1165-verdict.json
---

## 1165. Pin the landing-record and persist-out reconcile failure diagnostics

### Background

Session-review follow-up to the 1148 landing obligation and 1149 receiving lifecycle reconciliation. Commit `21466201e` exists and added three non-fatal diagnostics in `packages/app/src/services/inline-run-setup.ts`: landing-record failure at :1799, per-task reconcile failure at :2163, and outer reconcile failure at :2173. The current source still contains all three. The review transcript itself was not independently recovered; the commit, current source and tests are the evidence for this task.

The existing happy-path tests are `packages/app/tests/services/inline-run-setup.test.ts:1594` (markerless worktree close) and `packages/app/tests/services/inline-run-driver.test.ts:606` (receiving lifecycle reconciliation). A scoped search of `packages` and `plugins` test files on 2026-10-10 found no assertions naming any of the three diagnostics. This establishes missing explicit pins, rather than claiming a text search proves all possible behavioral coverage absent.

**Refine corrections (2026-10-10)**
- The original R2 accepted either reconcile message → there are two independent catches → require separate tests for both under R2, with AC2 and AC3.
- An unopenable target DB from the start → `persistWorktreeRuns` opens that DB before reconciliation and fails closed → inject failure only at its second target open, after transfer succeeds.
- An unwritable records directory / directory at the record filename → permission behavior varies and a directory fails the read before the write → place a regular file at the owning tree's `recordsDir`, so its recursive mkdir deterministically fails; keep linked-tree logging writable.
- The original success JSON listed only three fields → the runner also conditionally forwards `evidenceSkipped` → assert the exact fixture payload and sidecar, without changing the production payload contract.
- Original scenario titles used R-numbering and Design was empty → use task-local AC1–AC3 linked to R1/R2 and freeze the fixtures, observation points and mutation checks below.

Refinement evidence: both existing test files pass (64 tests, 0 failures). An isolated temporary probe using real migrated databases verified a SQLite update trigger reaches the inner catch, and a scoped `createMigratedDb` spy reaches the outer catch on target-open #2; both emitted their exact diagnostics with exit 0 and `{ok:true,persisted:0,skipped:[]}`. These are feasibility checks, not implementation or mutation-test receipts.

### Requirements

- [x] R1. Add a regression test in `packages/app/tests/services/inline-run-setup.test.ts` that forces owning-tree landing-record publication to fail for a real markerless linked-worktree run closed `done`. Assert the linked tree's durable run record contains `landing-record-failed run=<runId> path=<recordPath>:` followed by nonempty error detail, and close still returns 0 with successful stdout and committed terminal status.
- [x] R2. Add two independent tests in `packages/app/tests/services/inline-run-driver.test.ts`: one fails a receiving lifecycle update and pins `persist-out: reconcile skipped for <wbs>: <detail>`; the other fails the post-transfer target DB open and pins `persist-out: lifecycle reconcile unavailable: <detail>`. Each must call the real `runInlineRunPersistOut`, assert return 0, exactly one successful stdout JSON document, and unchanged fixture payload `{ok:true,persisted:0,skipped:[]}` in stdout and `.spur/run/persist-out.json`.
- [x] R3. Prove each of the three tests fails specifically on its missing-diagnostic assertion when only its corresponding catch body is temporarily emptied. Restore source after each mutation and rerun the two unmodified suites successfully; retain commands and outcomes as implementation evidence.

Out of scope: production behavior or API changes, new helpers exported from production, new dependencies, permission-based fixtures, blanket module mocks, new CLI flags, plugin regeneration, lifecycle policy changes, cleanup of real worktrees/data, and unrelated coverage work. Only the two named test files are expected production-tree implementation edits, plus task-owned evidence.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A failed landing-record write is logged, not swallowed (req: R1, R3)
  Given a real markerless linked worktree with a running run and at least one action row
  And its owning tree has a regular file at the durable records directory path
  When runInlineRunTrace closes the run done with projectRoot naming the linked tree
  Then the linked tree durable run record contains the exact run id and owning record path in a landing-record-failed diagnostic with nonempty error detail
  And the return code is 0, stdout reports success, and the stored run status is done
  And removing only this catch diagnostic makes this regression test fail

Scenario: AC2 — A failed task reconcile is named on stderr (req: R2, R3)
  Given a real successful empty-source persist-out and a forwarded done task with a stale receiving lifecycle row
  And a target-only SQLite trigger rejects updates of that row with a known error
  When runInlineRunPersistOut processes the forwarded task
  Then stderr contains persist-out: reconcile skipped for followed by the exact task id and injected error
  And stderr does not contain the outer lifecycle reconcile unavailable diagnostic
  And stdout and persist-out.json equal the fixture success payload and the return code is 0
  And the receiving row remains stale after the rejected update
  And removing only this catch diagnostic makes this regression test fail

Scenario: AC3 — A failed post-transfer database open is named on stderr (req: R2, R3)
  Given a real successful empty-source persist-out and a readable forwarded done task
  And only the second target database open rejects with a known error
  When runInlineRunPersistOut reaches lifecycle reconciliation
  Then stderr contains persist-out: lifecycle reconcile unavailable followed by the injected error
  And stderr does not contain a per-task reconcile skipped diagnostic
  And stdout and persist-out.json equal the fixture success payload and the return code is 0
  And removing only this catch diagnostic makes this regression test fail
```

### Q&A

- Closed: protect both reconcile catches rather than accepting either; the three diagnostics need three independent mutation-sensitive regression tests.
- Closed: use a regular-file obstruction at the owning records directory, a real SQLite update trigger, and a scoped second-target-open spy. Avoid chmod, timing races and blanket module mocks.
- Closed: retain successful return/payload behavior. This is test-only hardening of 1148/1149, with no public-surface or production-policy changes.
- Closed: keep task-local acceptance criteria under active E71. No additional feature, task split, dependency or operator decision is needed beyond the completed 1148/1149 prerequisites.

### Design

**WHAT / WHY.** Pin all three existing non-fatal error channels through real app runners, so successful close/transfer cannot silently lose their diagnostic. No new API, production branch, export, dependency, schema, configuration or generated artifact. Requirements R1–R3 map to AC1–AC3.

**WHERE / reuse.** Extend the existing tests adjacent to `inline-run-setup.test.ts:1594` and `inline-run-driver.test.ts:606`. Reuse `runStoragePaths`, fixture creation/cleanup, `inDir`, `captureAsync` and existing DB seeding patterns. Callers are the trace-mode dispatcher and plugin glue (`plugins/sp/scripts/inline-run-setup.ts:162` for persist-out); their signatures and outputs stay unchanged. No fixture/config/export files need changes.

**R1 fixture.** Follow the existing real Git main-repo/linked-worktree test, with no WT-3 marker. Canonicalize temporary roots using `realpathSync`. Seed a running run and a completed action row in the linked DB to avoid `NO_ACTION_ROWS`. Before closing, create the parent of `runStoragePaths(mainRepo).recordsDir` and write a regular file at `recordsDir` itself. The landing branch's `mkdirSync(recordsDir, {recursive:true})` then fails deterministically, independently of OS permission privileges. Leave the linked tree's storage writable so state projection and `appendInlineRunLogLine` succeed. Close with `projectRoot: linkedWt`; read the diagnostic from `join(runStoragePaths(linkedWt).recordsDir, runId + '.md')`, not the obstructed owning path. Assert exact run/path prefix and a nonempty detail, not an OS-specific error sentence. Capture stdout and check `ok:true`; query the linked DB for status `done`. Cleanup the linked worktree and temporary main repo in `finally` using the existing fixture pattern.

**R2 inner fixture.** Use two canonical temporary projects. The source DB has no run rows, yielding the exact stable transfer payload `{ok:true,persisted:0,skipped:[]}`. In the target, create a readable `docs/tasks5/1165_test.md` with `status: done` and no run citations; seed a `task-lifecycle` row with external key `task:1165`, status `interrupted`, and a valid started_at. Add a SQLite trigger `BEFORE UPDATE ON runs WHEN OLD.id = '<fixture-run-id>' BEGIN SELECT RAISE(ABORT, '1165 injected reconcile update failure'); END`. The empty transfer makes no update to that row; real reconciliation reaches `finalizeRun` and throws in the inner catch. Assert the named stderr line, exact success payload and sidecar, no outer diagnostic, and the row remains `interrupted`. Keep this fault inside the temporary target DB; no collaborator is mocked.

**R2 outer fixture.** Use fresh empty-source/target projects and a readable forwarded terminal task. After fixture setup, import the domain namespace with `import * as domain from '@gobing-ai/spur-domain'`, save the original `createMigratedDb`, then use `spyOn(domain, 'createMigratedDb')` with a passthrough implementation. Count calls only where `options.url === join(realpathSync(to.dir), '.spur', 'spur.db')`; allow target-open #1 for the real transfer, reject only target-open #2 with `Error('1165 injected reconcile open failure')`. Delegate every other call to the saved original, and assert exactly two target calls. This imported-function spy was verified with Bun 1.3.14; no `mock.module`, internal same-module function spy or timing/filesystem watcher is needed. Restore the spy in `finally`. Assert exact outer diagnostic and injected detail, no inner diagnostic, exact stdout/sidecar payload and exit 0.

**Observation and isolation.** The runner uses `process.stderr.write`, so a `console.error` spy cannot observe R2. Install a local `process.stderr.write` capture around each awaited call and restore it in `finally`; compose with existing `captureAsync` for stdout. Restore cwd, spies and streams before assertions wherever practical, including failed-call paths. Keep tests serial because cwd and streams are process-global. Do not replace `persistWorktreeRuns`, `runInlineRunPersistOut`, reconciliation, or the run-log appender with fakes. Do not widen `captureAsync` unless repeated code actually needs that small change.

**Mutation proof / gates.** Run each newly named test against a one-at-a-time temporary removal of its own diagnostic catch body; require a failure at the diagnostic assertion, not an unrelated fixture/exit assertion. Restore the original source bytes in `finally` before the next mutation; never commit mutated source. Do this only in a clean, exclusively owned implementation tree. After all three mutations, rerun both complete files inside `packages/app`, then the task pipeline's required `bun run spur-check`. No feature-wide/release gates or plugin builds are added for these tests alone.

**Dependencies / handoff.** Declare 1148 and 1149 as completed prerequisites: reuse their shipped landing and lifecycle behavior; do not redesign either. No dependent task is needed. E71 is active, and task-local AC altitude/numbering are intentional. At refinement, `git worktree list` showed only this main working tree and the WIP-task query returned none. The task file was already untracked; implementation must begin from an exclusively owned clean tree and recheck these facts. Bun is 1.3.14; installed ts-db and ts-dual-workflow-engine are 0.5.21, matching bun.lock. No dependency installation or generated refresh is required by this test-only scope.

### Plan

1. [x] Preflight: reread task and three catch sites, check clean tree/exclusive ownership, prerequisite statuses and current test baseline. Preserve the existing happy-path tests.
2. [x] R1 / AC1: add the real linked-worktree obstruction case and exact log, successful stdout, return-code and terminal-row assertions.
3. [x] R2 / AC2: add the real SQLite trigger case with scoped stderr capture, stable stdout/sidecar assertions and unchanged stale receiving row.
4. [x] R2 / AC3: add the scoped second-target-open spy case; assert call count, exact outer diagnostic, stable stdout/sidecar and exit 0. Restore every spy, stream and cwd in finally.
5. [x] R3 / AC1–AC3: mutation-check each catch separately with its new test, record the failing diagnostic assertion and restore source immediately. Confirm the final diff contains only intended test and task evidence changes.
6. [x] Run `(cd packages/app && bun test tests/services/inline-run-setup.test.ts tests/services/inline-run-driver.test.ts)`, then `bun run spur-check` through the task pipeline. Review, verify and record evidence for R1–R3 and AC1–AC3 through their owning harness stages; commit the completed task. No source/plugin build is necessary unless scope changes.

### Solution

Test-only hardening: the three non-fatal reconcile/landing diagnostics that 1148 and 1149 added are now each pinned by a real-runner regression whose failure depends on that one catch body.

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `packages/app/tests/services/inline-run-setup.test.ts:1654` | AC1: the existing markerless-worktree fixture (real `git init` + `git worktree add`, canonicalized temp roots, a `running` run plus a completed action row so `NO_ACTION_ROWS` cannot fire) with one addition — a regular file written at the OWNING tree's `recordsDir`, so the landing branch's recursive `mkdirSync` fails deterministically on any permission model. The close still returns 0, stdout still reports `ok:true`, the stored run status is `done`, and the LINKED tree's writable run record carries `landing-record-failed run=<id> path=<owning record path>:` followed by nonempty error detail. |
| `packages/app/tests/services/inline-run-driver.test.ts:1139` | AC2 + AC3, each with its own fault and its own observation point. AC2: an empty source (the exact stable transfer payload), a readable forwarded `status: done` task, a seeded `interrupted` `task:1165` lifecycle row in the target, and a real SQLite `BEFORE UPDATE ON runs … RAISE(ABORT, '1165 injected reconcile update failure')` trigger on that row — real reconciliation reaches `finalizeRun`, the update is rejected, and the inner catch emits `persist-out: reconcile skipped for 1165: <injected error>` with no outer diagnostic, unchanged payload/sidecar, and the row still `interrupted`. |
| `packages/app/tests/services/inline-run-driver.test.ts:1220` | AC3: fresh empty-source/target projects and a readable terminal task, with `spyOn(domain, 'createMigratedDb')` counting calls only for the canonical target URL — the first (real transfer) passes through, the second (reconcile) throws `1165 injected reconcile open failure`. The outer catch emits `persist-out: lifecycle reconcile unavailable: <injected error>`, no per-task diagnostic appears, the payload/sidecar stay the fixture success payload, and exactly two target opens are asserted. The spy is a namespace-import spy on a passthrough of the saved original, restored in `finally`; no `mock.module`, no internal same-module spy, no collaborator mock. |

Why this shape: each diagnostic is a non-fatal branch whose whole value is the message, so the only
faithful pin is a real run whose fault is injected at that branch's specific dependency — a
regular-file obstruction for the landing directory, a SQLite trigger for the reconcile UPDATE, and a
scoped second-open spy for the reconcile connection. All three fixtures are temporary, the injected
`run_1165_stale`/`run_1165_outer` rows and the trigger live only inside the disposable target DB,
and the regression tests assert the unchanged success contract alongside the diagnostic, so a future
change cannot buy a quieter log by dropping the message.

R3 mutation evidence (each run with the two unmodified suites green before and after):
- leaving only the landing-record catch empty → AC1 fails, 0 pass / 1 fail.
- leaving only the per-task reconcile catch empty → AC2 fails, 1 pass / 1 fail.
- leaving only the outer reconcile catch empty → AC3 fails, 1 pass / 1 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/inline-run-setup.test.ts:1654` builds a real `git init` main repo plus a linked worktree with no WT-3 marker, seeds a `running` run and a completed action row (so the zero-row close guard cannot fire), then writes a regular file at `runStoragePaths(mainRepo).recordsDir` so the landing branch's recursive `mkdirSync` fails deterministically. The close returns 0, stdout reports `ok:true`, the stored status is `done`, and the LINKED tree's durable record contains `landing-record-failed run=run_1165_landing path=<owning record path>:` followed by nonempty error detail |
| R2 | MET | Two independent tests at `packages/app/tests/services/inline-run-driver.test.ts:1139`: (inner) an empty source yields the exact stable payload, a seeded `interrupted` `task:1165` row in the target plus a real `BEFORE UPDATE` trigger rejecting that row's update produces `persist-out: reconcile skipped for 1165: 1165 injected reconcile update failure` and leaves the row `interrupted`; (outer) a namespace-level passthrough spy rejects only the second canonical target open and produces `persist-out: lifecycle reconcile unavailable: 1165 injected reconcile open failure`. Each asserts the other diagnostic absent, stdout and the persist-out sidecar written beside the fixture's run equal `{ok:true,persisted:0,skipped:[]}`, and exit 0 |
| R3 | MET | Mutation evidence for all three catches is recorded in `## Solution` and was re-run this session: emptying the landing-record catch fails AC1 (0 pass / 1 fail), emptying the per-task catch fails AC2, emptying the outer catch fails AC3, each with the two suites otherwise green (67 pass / 0 fail) and the production source restored afterwards |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A failed landing-record write is logged, not swallowed (req: R1, R3) | MET | test | `cd packages/app && bun test tests/services/inline-run-setup.test.ts tests/services/inline-run-driver.test.ts` — 67 pass / 0 fail. The landing case asserts exit 0, `ok:true`, stored status `done`, the exact run id and owning record path in the diagnostic, nonempty detail, and the AC's mutation clause |
| AC2 — A failed task reconcile is named on stderr (req: R2, R3) | MET | test | Same suite: the trigger case asserts the exact `persist-out: reconcile skipped for 1165: <injected error>` line, absence of the outer diagnostic, unchanged stdout and sidecar payload, the stale receiving row, and the mutation clause |
| AC3 — A failed post-transfer database open is named on stderr (req: R2, R3) | MET | test | Same suite: the spy case asserts the exact `persist-out: lifecycle reconcile unavailable: <injected error>` line, absence of the per-task diagnostic, unchanged stdout and sidecar payload, exit 0, exactly two canonical target opens, and the mutation clause |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1165
**Scope:** 1165 diff (2 test files: `packages/app/tests/services/inline-run-setup.test.ts`, `packages/app/tests/services/inline-run-driver.test.ts`, plus the task file). Test-only — no production file changed.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The AC3 fixture depends on `spyOn` over an ESM namespace (`@gobing-ai/spur-domain`). It works on Bun 1.3.14 and the test asserts the injected failure actually reached the catch (`targetOpens === 2` plus the exact message), so a silent non-interception would fail the test rather than pass it vacuously. | `packages/app/tests/services/inline-run-driver.test.ts:1220` | ACCEPTED |
| 2 | P4 (advisory) | usability | AC3 asserts the outer diagnostic is absent from the PER-TASK message rather than asserting the negative direction separately; the per-task branch cannot run in that fixture because the second open fails before reconciliation starts, so the assertion is sound but reads as belt-and-braces. | `packages/app/tests/services/inline-run-driver.test.ts:1258` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/tests/services/inline-run-setup.test.ts:1654` — real markerless linked worktree, regular file at the owning `recordsDir`, close returns 0 with `ok:true` and stored status `done`, and the linked tree's record carries `landing-record-failed run=<id> path=<owning path>:` plus nonempty detail |
| R2 | MET | `packages/app/tests/services/inline-run-driver.test.ts:1139` — two independent tests: the SQLite-trigger rejection pins `persist-out: reconcile skipped for 1165: <injected>` (and the row stays `interrupted`), and the scoped second-target-open rejection pins `persist-out: lifecycle reconcile unavailable: <injected>`; each asserts its own message present, the other absent, unchanged payload + sidecar, and exit 0 |
| R3 | MET | Mutation evidence recorded in `## Solution`: emptying only the landing-record catch fails AC1 (0 pass / 1 fail); emptying only the per-task catch fails AC2 (1 pass / 1 fail); emptying only the outer catch fails AC3 (1 pass / 1 fail) — each with the two suites otherwise green and the source restored afterwards |

##### Acceptance Criteria Verification

AC1, AC2 and AC3 are each a real-runner regression with a fault injected at that branch's specific
dependency (directory obstruction, SQLite trigger, second-open spy), and each asserts the unchanged
success contract alongside the diagnostic. All three ACs' "removing only this catch diagnostic makes
this regression test fail" clauses are demonstrated, not asserted.

##### Residual Risk

The only structural note is finding 1: one fixture relies on namespace-level `spyOn`. It is
self-verifying (a non-intercepting spy makes the test fail), the spy is restored in `finally`, and no
production behaviour, export, dependency, schema, config or generated artifact changed — so the blast
radius is the two test files.

**Next:** proceed to verify.

### References

- Feature E71: `docs/features/E71_disposable-run-scratch-with-durable-evidence-and-inspection.md` (active).
- Completed prerequisites: task 1148 (markerless landing obligation) and task 1149 (post-transfer lifecycle reconcile), resolved through `spur task show` on 2026-10-10.
- Diagnostic introduction: commit `21466201e97851922333bbb7e350b5bd5ccf819e`.
- Production owners: `packages/app/src/services/inline-run-setup.ts:1776` and :2143; `packages/app/src/workflow/lifecycle-adapter.ts:88`.
- Existing fixtures: `packages/app/tests/services/inline-run-setup.test.ts:1594`; `packages/app/tests/services/inline-run-driver.test.ts:606`; stdout capture at :79.
- Refinement baseline: two suites, 64 passing tests, 342 assertions, 0 failures on 2026-10-10. Temporary feasibility probe: `/tmp/spur-1165-refine-probe.ts` (non-authoritative scratch; fixtures and algorithms are frozen in Design, so implementation does not depend on retaining it).
- Concurrency check: one main worktree at `c50fb179f`, no WIP tasks at refinement; only pre-existing untracked 1165 task file. Recheck before implementation.

#### Implementation readiness evaluation (2026-10-10)

Outcome: **refined**; status **backlog → todo**; five corrections recorded in Background; priority **P2**; estimate **2 hours**.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | R1–R3 define observable diagnostics, preserved outcomes and mutation sensitivity; explicit non-goals. |
| design | true | Three deterministic fixtures, exact paths/errors, capture/restore contracts and two test-file targets; no new API. |
| plan | true | Six ordered steps map to R1–R3 / AC1–AC3, mutation proof and pipeline gates. |
| ac | true | AC1–AC3 use Scenario titles with req links; task-local numbering/altitude; task check has no findings. |
| decisions | true | Q&A closes catch coverage, fixtures and scope; no open decision. |
| dependencies | true | 1148 and 1149 are done, explicitly declared; E71 is active; no dependent handoff. |
| premises | true | Current catch sites/callers inspected; commit exists; scoped gap search, baseline 64/64 tests, both reconcile fault probes verified; runtime/dependencies and concurrency checked. |

Final deterministic gates: `spur task check 1165 --as todo --json` PASS, no findings; `spur rule run --preset recommended-pre-check --json` exits 0, 51 rules, no findings. No implementation pipeline ran; Solution/Testing/Review remain reserved for execution. Implementation regression tests and mutation checks are still to be written/run.

### History

- 2026-10-10T16:19:16.132Z backlog → todo (system)
- 2026-10-10T19:35:05.661Z todo → wip (system)
- 2026-10-10T19:42:14.645Z wip → testing (system)
- 2026-10-10T19:42:22.495Z testing → done (system)

