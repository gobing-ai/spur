---
schema_version: 1
name: Emit the structured action trace from the inline pipeline driver
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.224Z
updated_at: "2026-09-17T18:32:39.038Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - observability
  - adr-117
  - adr-047

---

## 0868. Emit the structured action trace from the inline pipeline driver

### Background

ADR-047 made the inline host-session driver the default surface for /sp:dev-run, /sp:dev-idea and /sp:dev-plan but left trace emission with the engine. 1,011 of ~1,400 run rows carry zero action_runs. Every downstream analytic — progress projection, tripwires, steering, escalation packets, cost attribution — therefore observes the minority of real work. A first-pass reading of this same data produced a wrong workflow retirement list, which is the concrete cost of the gap.

### Requirements

- [x] R1. Every action executed by the inline driver writes an action_runs row carrying node, kind, status, ok and duration_ms.
- [x] R2. The run's rows are queryable by run id without reading .spur/run/<run-id>.log.
- [x] R3. Emission is best-effort at the action boundary only: a persistence failure is recorded and the run still reaches its declared terminal state.
- [x] R4. The text run log remains, demoted to a human convenience; it is no longer the sole record.
- [x] R5. The emission path is shared with the engine surface rather than reimplemented, so the two surfaces cannot drift.
- [x] R6. The inline driver marks its run row terminal when the run reaches a declared terminal state; a successful inline run is never left non-terminal for `spur workflow clean` to reap as stale.
- [x] R7. The run-row closure path is shared with the engine surface, like the action emission path, so the two cannot report terminal state differently.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R4 — Inline driver runs land in the structured action trace
    Given a pipeline driven by the inline driver with "--agent" omitted
    When the run reaches a terminal state
    Then every executed action has an action_runs row carrying node, kind, status, ok and duration_ms
    And the run's rows are queryable by its run id without reading .spur/run/<run-id>.log

  @edge
  Scenario: R12 — Trace emission failure never wedges or fails the run
    Given the inline driver cannot persist an action event
    When the run continues
    Then the workflow reaches its declared terminal state
    And the emission failure is recorded without changing the run's outcome
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The obligation belongs to the execution surface (ADR-117). Extract the engine's existing action-boundary emission into a surface-agnostic writer in packages/app/src/workflow/ and have both the engine runner and the inline driver call it, rather than giving the inline driver a parallel implementation — a second writer would drift and reintroduce the gap under a new name. Wrap each emission in a failure boundary that records and continues: observation must never wedge the thing observed, and the inline driver runs in the operator's own session where a throw is maximally disruptive.

### Plan

1. Read the engine's current emission call sites and the action_runs row shape.
2. Extract the shared writer; move the engine onto it with no behaviour change; run existing tests.
3. Add emission calls to the inline driver's action boundaries.
4. Add the failure boundary and its record path.
5. Update plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md with the emission obligation.
6. Test: an inline run produces rows for every action; an injected writer failure still reaches terminal.

### Solution

Extract the engine's action-boundary emission into a surface-agnostic `WorkflowActionTraceWriter` and route both the engine runner and the inline host-session driver through it, so every inline action writes an `action_runs` row and a successful inline run closes its own run row terminal (ADR-117). The action boundary is best-effort; the run-row closure propagates its error (review finding #1); `--ok` and `--duration-ms` are required and exact (finding #2); an unobserved-start finalize keeps its run-id attribution (finding #3); and `--close` on a missing row fails with a named error (finding #4).

| Change | Anchor |
| --- | --- |
| Surface-agnostic `WorkflowActionTraceWriter`: action boundary (`saveActionStart`/`saveActionFinalize`/`recordAction`) best-effort through the engine's persistence; run-row closure (`finalizeRun`/`closeRun`) propagates its error and `closeRun` raises `RunRowNotFoundError` for a missing row | `packages/app/src/workflow/action-trace.ts:108` |
| `WorkflowActionTraceWriter`, `createWorkflowActionTraceWriter`, `withActionTrace`, `createRunLogTraceFailureRecorder`, `RunRowNotFoundError` and the boundary types re-exported from the app barrel | `packages/app/src/index.ts:694` |
| Engine composition wraps `DbWorkflowPersistenceAdapter` in `withActionTrace` with a run-log failure recorder — best-effort at the action boundary only; the run closure propagates | `packages/app/src/services/workflow-service.ts:1679` |
| Lifecycle surface wraps its adapter in `withActionTrace` — the same shared emission and closure path as the engine; its parking `finalizeRun` now fails loudly again | `packages/app/src/workflow/lifecycle-adapter.ts:119` |
| `runTraceMode` — the ADR-117 emission delegate: `--action` records a completed action boundary (best-effort, exit 0), `--close` marks the run row terminal and fails loudly (exit 1) on a missing row or persistence failure; `--ok`/`--duration-ms` are required and exact | `plugins/sp/scripts/inline-run-setup.ts:241` |
| Driver contract documents the emission obligation: the text log is demoted to a human convenience; every action emits a row; `--action` is best-effort, `--close` is bookkeeping and fails loudly | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:414-427` |
| `WorkflowActionTraceWriter` unit tests: rows queryable by run id, best-effort start/finish failures, propagating closure, `RunRowNotFoundError`, and the run-id-preserving finalize attribution | `packages/app/tests/workflow/action-trace.test.ts:43` |
| `WorkflowActionTraceWriter` delegate end-to-end: setup → action → close lands a run-id-queryable row plus a terminal run row; `--ok`/`--duration-ms` usage errors exit 2; a missing-row close exits 1 | `plugins/sp/tests/inline-run-trace.test.ts:199-274` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/action-trace.ts:176-206` re-read: recordAction composes saveActionStart+saveActionFinalize carrying node/kind/status/ok/duration_ms; driver contract mandates it per action at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:412-427` (re-read: --action --run-id --node --kind --status --ok --duration-ms). Tests re-run: `packages/app/tests/workflow/action-trace.test.ts` 16 pass, `plugins/sp/tests/inline-run-trace.test.ts` 6 pass (2026-09-17). |
| R2 | MET | Rows queryable by run id via ActionRunDao/raw SQL, no text-log read — covered by inline-run-trace.test.ts:62,91-102 in the 6-test pass; workflow progress renders attempts from the same rows (0867 surface). |
| R3 | MET | `action-trace.ts` guard returns {ok:false} instead of throwing at the action boundary; closure is deliberately unguarded (RunRowNotFoundError propagates) — re-read at :209-215 comment naming review finding #4. Tests :163,:237,:258 + inline-run-trace :123 in passing sets. |
| R4 | MET | Driver contract re-read at `inline-pipeline-driver.md:401-403`: text log demoted to human convenience; emission failures append trace-emission-failed lines (tests action-trace.test.ts:456,475 in passing set). |
| R5 | MET | Single emission path re-read: `action-trace.ts` writer wrapped around DbWorkflowPersistenceAdapter; contract text at `inline-pipeline-driver.md` (~:410) states one emission path + one closure path so surfaces cannot drift. |
| R6 | MET | closeRun raises RunRowNotFoundError on missing row and delegates finalizeRun (`action-trace.ts:209-215` re-read); delegate --close maps to exit 1 RUN_NOT_FOUND; tests action-trace.test.ts:117,227 + inline-run-trace.test.ts:62,276 pass. |
| R7 | MET | finalizeRun/closeRun are the same writer methods the engine terminal closure and lifecycle parking use — closure delegation asserted by action-trace.test.ts:130 (passing). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R4 — Inline driver runs land in the structured action trace | MET | test | Re-run 2026-09-17: `bun test tests/inline-run-trace.test.ts` 6 pass (setup→--action→--close end-to-end asserts action_runs row fields + terminal runs row by run id); `bun test tests/workflow/action-trace.test.ts` 16 pass. Stated limit stands: driver procedure is skill prose; coverage is the mandated delegate + contract. |
| Scenario: R12 — Trace emission failure never wedges or fails the run | MET | test | inline-run-trace.test.ts:123 (unresolvable writer → exit 0 {ok:false}, failure recorded, run unaffected) and action-trace.test.ts:163,237 (injected start/finish failure swallowed+recorded, run still closes terminal) in passing sets; closure failure propagates by design (:202). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0868 (pass 2, post-disposition)

**Scope:** uncommitted worktree diff vs HEAD `7fb4459bc` — 8 files, +1,423/−3, reviewed as one change set: the surface-agnostic writer `packages/app/src/workflow/action-trace.ts` (336 lines) plus its barrel export, the engine and lifecycle composition wraps, the `--action`/`--close` emission delegate in `plugins/sp/scripts/inline-run-setup.ts` (+183/−1), the driver-contract section in `inline-pipeline-driver.md` (+54), and two test suites (820 lines). The diff spans the implement stages (timed-out first dispatch + continuation) **and** the operator-directed repair of 19:26Z, so pass 2 reviews the repaired tree, not the pass-1 subject. Pass 1's verbatim body is superseded by this one; every pass-1 finding is dispositioned below and its preserved text is at `.spur/run/0868-review-pass1-answer.txt`.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — 0 P1, 0 P2, 0 P3, 8 P4 (advisory). The one P2 and the three P3 findings pass 1 raised are verified fixed on fresh live evidence; the eight remaining findings are advisory, four of them carried from pass 1 unchanged.
**Independence:** reviewer session separate from implement and from the repair; implementation context reached this stage only via the persisted task spec, the reviewed diff and the run artifacts. Executor-distinctness for this P0 task cannot be attested on the inline host path (no executor registry at this boundary) — surfaced as a limit, not silently discarded.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | usability | The two trace-failure recorders write the **same** run log with different stamps. The delegate strips milliseconds (`[2026-09-16T19:38:32Z]`, matching the driver contract's "This normalization is contractual"); `createRunLogTraceFailureRecorder` writes `failure.at` verbatim, i.e. `new Date().toISOString()` with milliseconds (fresh: `[2026-09-16T19:46:40.109Z]`). Both are ISO-8601 UTC so no parser breaks, but one change now produces two formats in the file the doc calls contractual. Carried from pass-1 #5; not in the operator's disposition list. | `plugins/sp/scripts/inline-run-setup.ts:222-231`; `packages/app/src/workflow/action-trace.ts:319-336`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:395-399` |
| 2 | P4 (advisory) | correctness | A finalize for an action id this writer instance never observed still loses attribution. `saveActionFinalize` resolves the boundary from an in-memory map and falls back to `runId: ''`; the recorder then sanitises `''` to `''` and appends to `.spur/run/.log` — a hidden file with no run attribution. Fresh probe: `saveActionFinalize('foreign-id', …)` against a throwing inner records `runId: ''`. **Not reachable from the engine sequence** — `runActionStep` always calls `saveActionStart` first and hands that id (including the synthetic `trace-unpersisted:<uuid>` id, now remembered) to the finalize on the same writer instance, so this is the residual half of pass-1 #3, not a reopened defect. Fix: key the fallback on a remembered last-start identity, or refuse an unobserved finalize. | `packages/app/src/workflow/action-trace.ts:144-160,218-244,319-336` |
| 3 | P4 (advisory) | usability | `--action` reports an emission failure in **two different stdout shapes**. `recordAction` returns the guard's `{ok:false, failure:{operation,runId,node,kind,error,at}}`, which the delegate spreads as `{"ok":false,"failure":{…},"runId":"…"}`; the delegate's own pre-writer failure path prints `{"ok":false,"runId":"…","error":"…"}`. Fresh: `--action` against a run id with no row → FK failure, exit 0, nested `failure` object. A caller (the driver is a model) looking for `error` finds nothing at the top level. The contract only promises `{"ok":false}`, so this is cosmetic, but both paths should emit one shape. | `plugins/sp/scripts/inline-run-setup.ts:244-252,262-291`; `packages/app/src/workflow/action-trace.ts:176-206` |
| 4 | P4 (advisory) | correctness | `--action` accepts `--status running` and `--status paused`, and `usage()` advertises `--status <done|failed|running|paused>`, while the engine's finalize vocabulary is `done`/`failed` (`action-step.ts:104` passes `result?.ok !== false ? 'done' : 'failed'`) and the driver contract's example says `--status <done|failed>`. A settled action can therefore be recorded as still running, and the help text and the contract disagree on the accepted set. | `plugins/sp/scripts/inline-run-setup.ts:203,373`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:417-424` |
| 5 | P4 (advisory) | architecture | The delegate hand-declares the app module's writer surface in a cast (`openInlineRunProjectDb`, `createWorkflowActionTraceWriter`) with no compile-time link to `packages/app`, so an app-side signature change drifts silently. Same pattern and severity as 0862 finding #5 and pass-1 #6; the repo-only script posture (ADR-065) leaves the cast as the only option short of a shared type entry. Not in the operator's disposition list. | `plugins/sp/scripts/inline-run-setup.ts:262-278` |
| 6 | P4 (advisory) | architecture | ADR-117 defines the trace as an `action_runs` row **and** one start/finish `system_events` pair per boundary. This task delivers the persistence half only: the delegate writes rows through the shared writer but attaches no observability bus, so inline actions still emit no `workflow.action.start/finish` events and the event-stream consumers named in the task Background still see nothing on the default surface. R1–R7 and both scenarios are row-scoped, so this is outside the task's declared scope rather than a requirement miss — flagged so the feature-scoped pass assigns it explicitly (no other D62 task names the inline surface for event emission). Carried from pass-1 #7. | `docs/00_ADR.md:1745-1752`; `docs/design/workflow-execution-economy.md:88-91`; `plugins/sp/scripts/inline-run-setup.ts:280-291` |
| 7 | P4 (advisory) | correctness | Rows whose `node`/`kind` do not match a declared state/action are persisted but invisible to `spur workflow progress`, with no diagnostic. Fresh: `--action --node implement --kind agent.run` against a definition declaring only `start`/`end` leaves an `action_runs` row that the projection omits entirely (`states` shows only `start`/`end`, `diagnostics: []`). The driver contract does instruct `<state-id>`/`<action-kind>` from the YAML, so the doc is right; the *consequence* of getting it wrong — silently unprojected rows, no `orphan`/`ambiguous` diagnostic — is not stated. Carried from pass-1 #8; not in the operator's disposition list. | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:417-427`; `packages/app/src/workflow/progress-projection.ts:351-358` |
| 8 | P4 (advisory) | correctness | Two §Solution change-map anchors do not name their row's subject, per `spur task check 0868` (L4.anchor-subject-mismatch, warning): `inline-pipeline-driver.md:401` cites the new section's heading rather than the `--action`/`--close` contract lines (`:414-427`), and `inline-run-trace.test.ts:62` cites the e2e test declaration rather than the `--ok`/`--duration-ms` cases (`:199-274`). Non-blocking (`pass: true`) and the Solution section is outside the proof-input set, but the same checker warning class was a pass-1 finding on 0867, so it is recorded rather than skipped. | `docs/tasks5/0868_emit-the-structured-action-trace-from-the-inline-pipeline-dr.md` §Solution; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:401`; `plugins/sp/tests/inline-run-trace.test.ts:62` |

##### Disposition of the pass-1 findings (operator-directed repair, 19:26Z)

| # | Pass-1 priority | Disposition | Fresh evidence this stage |
| --- | --- | --- | --- |
| 1 | P2 (major) | **FIXED** — the best-effort guard is narrowed to the action boundary; `finalizeRun` delegates unguarded, so the engine's terminal closure and `LifecycleAdapter.requestTransition`'s parking write fail loudly again | `action-trace.ts:167` — `return this.inner.finalizeRun(...)`; live probe: `finalizeRun propagated: injected close failure`, `closeRun propagated: injected close failure`; `action-trace.test.ts` — `finalizeRun propagates a persistence failure directly` + `a run-closure persistence failure propagates` |
| 2 | P3 (minor) | **FIXED** — `--ok` must be exactly `true`/`false` and `--duration-ms` must be present and a finite non-negative number; all four malformed spellings now exit 2 | live: `--ok` omitted → exit 2; `--ok True` → exit 2; `--duration-ms` omitted → exit 2; `--duration-ms nope` → exit 2; `inline-run-trace.test.ts` — `--ok and --duration-ms are required and exact` (5 cases) |
| 3 | P3 (minor) | **FIXED for the reachable scenario** — a failed start remembers the boundary identity under its synthetic `trace-unpersisted:<uuid>` id, so the follow-up finalize keeps the run id. Residual (unobserved foreign id) recorded as finding #2 above | live probe against a throwing inner: `[{op:'action.start',runId:'run-abc',node:'implement'},{op:'action.finish',runId:'run-abc',node:'implement'}]`; `action-trace.test.ts` — `a finalize whose start this instance never observed keeps the run id in the failure record` |
| 4 | P3 (minor) | **FIXED** — `closeRun` checks `loadRun` and raises `RunRowNotFoundError`; the delegate maps it to exit 1 with `code:"RUN_NOT_FOUND"` and a `trace-close-failed` log line, never a false `{"ok":true}` | live: `--close --run-id run-0868-does-not-exist --status done` → exit 1, `{"ok":false,"runId":"run-0868-does-not-exist","error":"run row not found: …","code":"RUN_NOT_FOUND"}`; `inline-run-trace.test.ts` — `--close for a run id with no row fails loudly` |
| 5 | P4 (advisory) | **OPEN** — carried unchanged as finding #1 | live format probe (see Verification evidence) |
| 6 | P4 (advisory) | **OPEN** — carried unchanged as finding #5 | cast unchanged at `inline-run-setup.ts:266-278` |
| 7 | P4 (advisory) | **OPEN** — out of the task's declared scope; carried as finding #6 for feature-level assignment | delegate still constructs no observability bus |
| 8 | P4 (advisory) | **OPEN** — carried unchanged as finding #7 | live projection probe (see Verification evidence) |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `recordAction` composes the engine's own `saveActionStart` + `saveActionFinalize` (`action-trace.ts:176-200`); the delegate exposes it as `--action` (`inline-run-setup.ts:353-382`); the contract makes one call per settled action mandatory (`inline-pipeline-driver.md:412-427`). Fresh live scratch-project run: `--action --node start --kind shell --status done --ok true --duration-ms 4321` landed row `('start','shell','done',duration_ms=4321,ok=1)`, and `--ok false` landed `ok=0`. |
| R2 | MET | Rows are queryable by run id without the log: fresh raw-SQL read of the scratch DB returned the row by `run_id`, and a fresh `spur workflow progress run-0868-live2 --json` rendered the attempt (`actionRunId`, `status: done`, `ok: true`, `durationMs: 4321`) with no read of `.spur/run/<run-id>.log`. Tests `action-trace.test.ts:62,88`, `inline-run-trace.test.ts:91-102`. |
| R3 | MET | Best-effort at the action boundary only: `guard()` records and never throws (`action-trace.ts:218-244`), a failed start returns a synthetic id so the control loop continues (`:122-142`), and a throwing recorder is contained (`:235-239`). Fresh live: `--action` against a run id with no row hit an FK failure → exit 0 with `{"ok":false,…}` and a `trace-emission-failed … FOREIGN KEY constraint failed` line in `.spur/run/run-0868-ghost.log`. Tests `action-trace.test.ts:163,237,258`; `inline-run-trace.test.ts:123`. |
| R4 | MET | The text log remains and is demoted: the contract states it (`inline-pipeline-driver.md:401-403`) and both failure paths append to `.spur/run/<run-id>.log` rather than replacing it — fresh: the delegate wrote `run-0868-ghost.log` / `run-0868-does-not-exist.log` beside the untouched setup artifact. |
| R5 | MET | One emission path, not two: the engine composition wraps `DbWorkflowPersistenceAdapter` in `withActionTrace` (`workflow-service.ts:1679-1682`), the lifecycle surface does the same (`lifecycle-adapter.ts:119-122`), and the delegate calls the same `createWorkflowActionTraceWriter` factory. Repo-wide grep for `new DbWorkflowPersistenceAdapter` finds only those sites plus `packages/app/src/services/inline-run-setup.ts:257` (`createOrAttachRun` only — no action or closure writes). |
| R6 | MET | The inline driver closes its own row: fresh live `--close --status done` set the row `status='done'` with `completed_at=2026-09-16T19:38:01.117Z`, and `workflow progress` then reported `completed`. A missing row now fails loudly instead of reporting a false success (disposition #4). Tests `action-trace.test.ts:117`, `inline-run-trace.test.ts:62,276`. |
| R7 | MET | Closure path shared with the engine: `closeRun`/`finalizeRun` route through the same writer the engine runner uses (`action-trace.ts:167,209-215`), asserted by the delegation test (`action-trace.test.ts:130`) and the delegate end-to-end terminal-row assertion; the repair kept the path shared and only removed the swallow. |

##### Acceptance criteria

| Scenario | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R4 — inline driver runs land in the structured action trace | MET (delegate surface; the driver procedure itself is prose) | executed | Fresh scratch-project e2e: setup → `--action` ×2 → `--close` produced rows carrying node/kind/status/ok/duration_ms queryable by run id through raw SQL and `spur workflow progress`, plus a terminal run row. |
| R12 — trace emission failure never wedges or fails the run | MET | executed | Fresh live unresolvable-writer and FK-failure paths both exit 0 with `{"ok":false}` and a recorded `trace-emission-failed` line; unit failures on start, finish and close record and never throw, and the run still closes terminal (`action-trace.test.ts:158-232`). |

**Honest note on the core scenario.** Its Given-clause — "a pipeline driven by the inline driver with `--agent` omitted" — is not executable by a test: the driver is the skill's prose procedure, not code. Coverage is the delegate end-to-end plus the contract text, not a synthetic inline run. Plan step 6's first half is met at the delegate boundary only; that is a stated limit, not a hidden one.

##### Verification evidence (fresh this stage)

| Command | Result |
| --- | --- |
| `cd packages/app && bun test tests/workflow/action-trace.test.ts` | `16 pass / 0 fail`, 40 expect() calls — R4 rows, R6/R7 closure, R5 delegation, R12 start/finish/close failures, throwing recorder, closure propagation (disposition #1), `RunRowNotFoundError` (#4), synthetic-id attribution (#3), 13-method pass-through census |
| `cd plugins/sp && bun test tests/inline-run-trace.test.ts` | `6 pass / 0 fail`, 33 expect() calls — setup→action→close e2e with raw DB assertions, unresolvable-writer exit 0, `--ok false` → `ok=0`, 5 malformed `--ok`/`--duration-ms` cases exit 2, missing-row close exit 1, usage guards |
| `bun run test` (root, whole monorepo) | `8339 pass / 0 fail`, 472 files, 34,014 expect() calls, 198s — matches `.spur/run/0868-test-gate.status` PASS |
| `bun run lint` (biome check + `bun run --filter '*' typecheck`) | exit 0 — all 7 workspaces typecheck clean |
| Fresh live scratch-project e2e (`/tmp`, `SPUR_BIN` at this checkout; nothing written to the tree) | `--action` → `{"ok":true,"actionId":…}`; `--close` → `{"ok":true}`; rows `[('start','shell','done',4321,ok=1)]`, run row `done` + `completed_at`; `workflow progress` rendered the attempt as `passed`/`ok:true`/`durationMs:4321` |
| Fresh live delegate edge probes | `--ok` omitted, `--ok True`, `--duration-ms` omitted, `--duration-ms nope` → all exit 2; `--close` on a missing row → exit 1 `RUN_NOT_FOUND` + `trace-close-failed` log line; `--action` on a missing row → FK failure, exit 0, logged |
| Fresh live writer probe (`bun /tmp/…/probe.ts` against the exported class, nothing written to the tree) | synthetic id `trace-unpersisted:<uuid>`; failures `[{action.start,runId:'run-abc'},{action.finish,runId:'run-abc',node:'implement'}]`; a foreign action id records `runId:''`; `finalizeRun`/`closeRun` both propagate `injected close failure` |
| Fresh live format probe (`/tmp`, app recorder) | app recorder line `[2026-09-16T19:46:40.109Z] trace-emission-failed …` vs delegate line `[2026-09-16T19:38:32Z] …` — the evidence for finding #1 |
| Fresh live projection probe | `implement/agent.run` row present in `action_runs`, absent from `workflow progress`'s `states` with `diagnostics: []` — the evidence for finding #7 |
| `git status --porcelain` vs `.spur/run/0868-pre-review2-snapshot.txt` | identical 9-entry set after this stage's writes; nothing staged |
| `bun apps/cli/src/index.ts task check 0868 --json` | `pass: true`, no missing sections — 2 L4 anchor-subject **warnings** in §Solution (recorded as finding #8), none in §Review |

##### Coverage / honest-loss audit

- Writer branches asserted: start success, start failure + synthetic-id continuation, finalize success, finalize failure, close success, close failure, throwing recorder, closure propagation, missing-row close, and all 13 pass-through methods (`action-trace.test.ts:62-427`). Not asserted: a finalize on a *foreign* action id (finding #2) and the `runId: ''` fallback itself.
- Delegate paths asserted: `--action`, `--close`, unresolvable-writer, `--ok false`, four malformed `--ok`/`--duration-ms` spellings, missing-row close, and four usage guards (`inline-run-trace.test.ts:62-330`). Not asserted: `--status running|paused` on `--action` (finding #4) and the nested-`failure` stdout shape (finding #3).
- The two composition wraps are still not covered by a test asserting the writer is installed on those construction sites; the 8339/0 monorepo suite shows no regression, and the live probes exercised the same factory the delegate uses.
- No production path lost coverage: the full monorepo suite is green and `action-trace.ts` is the only new module.

##### Reviewer mutation statement

No source file was touched by this stage — verified by `git status --porcelain` against the pre-review snapshot. Probe scripts, scratch projects and the pass-1 answer copy live under `/tmp` and the gitignored `.spur/run/`; the only task-side write is the `## Review` section via `spur task update --section`, which the proof-input fingerprint excludes from the certified input set (spec content is scoped to Background/Requirements/Acceptance Criteria/Design/Plan).

**Residual risk.** (1) Inline actions stay absent from `system_events` (finding #6) until the feature pass assigns that work. (2) A finalize with an action id this writer never observed still writes an unattributed run log (finding #2) — unreachable from the engine sequence, reachable from the public API. (3) `closeRun` checks existence and then finalizes in two statements, so a row deleted between them would report success (no test, no realistic producer). (4) The run log now carries two timestamp formats (finding #1). (5) The driver contract stays prose: R6's guarantee is enforceable only at the delegate boundary.

**Next:** the P2 blocker is cleared and the three P3s are fixed; approve (the `auto` profile routes straight past `approve`) → `/sp:dev-verify 0868`.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T18:31:52.606Z todo → wip (system)
- 2026-09-16T20:23:17.968Z wip → testing (system)
- 2026-09-16T20:23:19.899Z testing → done (system)

