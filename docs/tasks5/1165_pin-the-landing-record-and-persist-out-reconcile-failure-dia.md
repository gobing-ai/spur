---
schema_version: 1
name: Pin the landing-record and persist-out reconcile failure diagnostics
status: todo
template: feature-impl
created_at: 2026-10-10T16:02:04.236Z
updated_at: "2026-10-10T16:19:41.387Z"
feature_id: E71

ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1148", "1149"]
priority: P2
estimate_hours: 2
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

- [ ] R1. Add a regression test in `packages/app/tests/services/inline-run-setup.test.ts` that forces owning-tree landing-record publication to fail for a real markerless linked-worktree run closed `done`. Assert the linked tree's durable run record contains `landing-record-failed run=<runId> path=<recordPath>:` followed by nonempty error detail, and close still returns 0 with successful stdout and committed terminal status.
- [ ] R2. Add two independent tests in `packages/app/tests/services/inline-run-driver.test.ts`: one fails a receiving lifecycle update and pins `persist-out: reconcile skipped for <wbs>: <detail>`; the other fails the post-transfer target DB open and pins `persist-out: lifecycle reconcile unavailable: <detail>`. Each must call the real `runInlineRunPersistOut`, assert return 0, exactly one successful stdout JSON document, and unchanged fixture payload `{ok:true,persisted:0,skipped:[]}` in stdout and `.spur/run/persist-out.json`.
- [ ] R3. Prove each of the three tests fails specifically on its missing-diagnostic assertion when only its corresponding catch body is temporarily emptied. Restore source after each mutation and rerun the two unmodified suites successfully; retain commands and outcomes as implementation evidence.

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

1. [ ] Preflight: reread task and three catch sites, check clean tree/exclusive ownership, prerequisite statuses and current test baseline. Preserve the existing happy-path tests.
2. [ ] R1 / AC1: add the real linked-worktree obstruction case and exact log, successful stdout, return-code and terminal-row assertions.
3. [ ] R2 / AC2: add the real SQLite trigger case with scoped stderr capture, stable stdout/sidecar assertions and unchanged stale receiving row.
4. [ ] R2 / AC3: add the scoped second-target-open spy case; assert call count, exact outer diagnostic, stable stdout/sidecar and exit 0. Restore every spy, stream and cwd in finally.
5. [ ] R3 / AC1–AC3: mutation-check each catch separately with its new test, record the failing diagnostic assertion and restore source immediately. Confirm the final diff contains only intended test and task evidence changes.
6. [ ] Run `(cd packages/app && bun test tests/services/inline-run-setup.test.ts tests/services/inline-run-driver.test.ts)`, then `bun run spur-check` through the task pipeline. Review, verify and record evidence for R1–R3 and AC1–AC3 through their owning harness stages; commit the completed task. No source/plugin build is necessary unless scope changes.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

