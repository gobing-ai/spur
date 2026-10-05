---
schema_version: 1
name: Start or resume a workflow run from a chosen state
status: done
template: feature-impl
created_at: 2026-10-04T06:57:19.805Z
updated_at: "2026-10-05T22:47:23.594Z"
feature_id: D6

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1072-verdict.json
---

## 1072. Start or resume a workflow run from a chosen state

### Background

A workflow run that finishes without doing all the work the operator wants has no engine path to continue it.

Live example (20261002 knowledge-kit daily episode): the run was launched with `publish_enabled=false`, so the
state machine correctly reached `quality-control → done` (run `aed3a205-4cc8-4049-8fab-f9f82a35acd9`,
2026-10-03T03:27Z → 04:26Z). Publishing that episode afterwards had no `spur workflow run` entry point: the CLI
offers `--run-id`, `--vars`, `--dry-run`, `--async`, `--no-plan`, `--quiet`, `--silent`, `--verbose`, `--detail`,
`--trace-file`, `--no-log`, `--steer`, `--json` — no start-state option. `spur workflow continue [run-id]` only
resumes a `paused`/`interrupted` run from its own persisted state (engine `WorkflowService.resumeRun` refuses any
other status), and `--run-id` refuses an existing id (0901 R1). The tail was therefore driven stage-by-stage with
`kk stage …`.

That hand chain omitted three channels (en/ja `translate`, `xhs-write`/`xhs-publish`, `wechat-publish`) and nothing
said so: the run's own artifacts still reported `full`, the trace recorded none of it, and the gap surfaced only
when the operator looked at the published sites. knowledge-kit has since added a per-channel completeness report
(`31-publish/<run_date>_17_publish_completeness.json`) so a hand-driven tail cannot hide, but that treats the
symptom. Structurally, a resumed publish is always hand-driven, and a hand-driven tail is always incomplete in ways
the harness cannot see.

The same gap applies in the other direction: a run that paused or failed mid-graph can only be resumed from its
own state, so re-driving one segment (e.g. the publish tail after fixing a credential) means either re-running the
expensive earlier nodes or leaving the engine entirely.

**Re-evaluation 2026-10-04 (against `@gobing-ai/ts-dual-workflow-engine` 0.5.15).** The original Design assumed
`WorkflowService.run` already resolves a start state. It does not: `StateMachineDriver.run` /
`TransitionFlowDriver.run` always begin at `initialState`/`initialNode`; the private `loop(…, resumeFromState)`
parameter is reachable only through `resume()`, which also loads the *same run's* snapshot and defaults to
`skip-enter` — wrong semantics for a fresh run. The state/node schema is `.strict()`, so a `startable` marker cannot
be added from spur-new either. This task therefore depends on an upstream engine change (Plan step 0).

### Requirements

- [x] R1. **Engine dependency.** Consume an engine release (≥ 0.5.16, upstream ts-libs task) that adds
  `WorkflowRunOptions.startState` and a per-state/per-node `startable: boolean` schema field, with fresh-run
  semantics: the start state's on-enter/node action **executes**, no snapshot is loaded, `transitionsTaken` starts at
  0, and an undeclared / terminal / failure / non-`startable` start state, or any `kind: dag` workflow, is refused
  with an `FSMError` before a run row is created. Bump the spur-new `catalog` pins accordingly.
- [x] R2. `spur workflow run <file> --from <state-id>` starts a **fresh** run at that state. `--from-run <run-id>`
  (only valid together with `--from`) records lineage to a prior run and inherits its vars. Run ids are never
  reused: the source run is never mutated and the 0901 R1 existing-run refusal stays.
- [x] R3. Refusals are loud and side-effect free: unknown state (message lists the valid `startable` ids), state not
  marked `startable`, terminal/failure state, DAG workflow, `--from-run` without `--from`, unknown source run id. Each
  exits non-zero (validation → 2) before any run row, run-record file, plan artifact, or async worker is created.
- [x] R4. Nothing before the start state executes or is recorded as done. Run-row `metadata_json` carries
  `startState` (and `continuedFrom`, `continuedFromDigest` when `--from-run` is given); the run-start plan marks
  states that precede the start point as `unattempted` with note `before start state` — never `completed`.
- [x] R5. Var precedence: workflow defaults < source run's last-snapshot effective vars (only with `--from-run`,
  excluding engine/runtime-internal `__*` keys) < `--vars`. Guards, transitions, `terminalReason`, failure states,
  `iterationBound` and `onError` policies behave exactly as in a normal run from that state onward.
- [x] R6. `--dry-run --from` walks the graph from the start state without executing actions; `--async --from` threads
  `startState`/`continuedFrom` to the worker and the worker's digest/plan check covers them.
- [x] R7. Lineage is visible: `spur workflow trace` (list and `trace <run-id>`, human and `--json`) shows
  `startState` and `continuedFrom`; the `.state.json` projection gains the same optional fields additively.
- [x] R8. Absent `--from`, behavior and output are byte-for-byte unchanged: pause/`continue`, interrupt, `--async`,
  `--steer`, run memory, the two-file run record, and no `startState` key in metadata.
- [x] R9. Documented surface: ADR-051 consent recorded in `docs/design/harness-surface-governance.md`; `--from` /
  `--from-run` semantics, the `startable` opt-in rule, var precedence, and a worked publish-tail example in
  `spur workflow run --help` and `docs/design/cli-contracts.md`.

### Acceptance Criteria

- AC1 — Given a state-machine fixture whose every state's action appends its id to a marker file, and state `S3`
  marked `startable: true`, when `spur workflow run fixture.yaml --from S3 --vars '{…}'` runs, then the marker file
  contains only `S3` and its successors, the run reaches the expected terminal state, and `spur workflow trace <id>
  --json` reports `startState: "S3"`. Same assertion for a transition-flow fixture. (req: R1, R2, R4, R5)
- AC2 — Given each refusal case in R3, when the command runs, then it exits non-zero with the specific message
  (unknown state lists valid `startable` ids) and the run table, `.spur/memory/runs/`, and `.spur/run/` gain no new
  entry. (req: R1, R3)
- AC3 — Given a completed source run whose last snapshot has `publish_enabled: "false"` and `__hitlAnswer`, when a new
  run starts with `--from <s> --from-run <src> --vars '{"publish_enabled":"true"}'`, then the new run sees
  `publish_enabled: "true"`, inherits the other source vars, does not inherit `__*` keys, records `continuedFrom:
  <src>` + `continuedFromDigest`, and the source run row is unchanged. (req: R2, R5)
- AC4 — Given a KIT-shaped fixture reproducing the `kk-daily-ai-voice` tail topology (`publish-prep → publish-surfdash
  → show-notes → publish-podcast → xhs-write → xhs-publish → wechat-publish → … translate … → run-report → done`,
  stub shell actions writing per-state receipt files, `publish-prep` refusing without a safety stamp file), when it
  is started at `publish-prep` with the stamp present, then every channel state including `translate`, `xhs-*` and
  `wechat-publish` leaves a receipt; and when started without the stamp, then the run fails at `publish-prep` with a
  failure terminal reason and no later receipt exists. (req: R5)
- AC5 — Given `--dry-run --from S3`, then no marker is written, the walk starts at `S3`, and metadata carries both
  `dryRun: true` and `startState`. Given `--async --from S3`, then the worker run records the same `startState` and
  the plan artifact marks pre-start states `unattempted`. (req: R4, R6)
- AC6 — Given a continued run, when `spur workflow trace` (list) and `spur workflow trace <id>` are read in human and
  `--json` forms, then source run id and start state are shown. (req: R7)
- AC7 — Given the existing pause/continue, interrupt, `--async`, `--steer` and `--dry-run` suites, when the change
  lands, then they pass unmodified and a run without `--from` produces no `startState`/`continuedFrom` keys.
  (req: R8)
- AC8 — `spur workflow run --help` lists `--from`/`--from-run`; `bun run spur-check` and `bun run build` pass; the
  ADR-051 consent entry links this task. (req: R9)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-05T04:47:47.234Z

Closed during the 2026-10-04 re-evaluation (pending operator confirmation of Q1 only — ADR-051 consent):

- **Q1 Surface (ADR-051).** Both layers, one authority: `WorkflowAppService.run(file, { startState, continuedFrom })`
  owns validation, var seeding and metadata; the CLI flags are thin adapters, so the board can call the service later
  without a second implementation. New public flags on an existing verb need operator consent — record it in
  `harness-surface-governance.md` before Plan step 2. **Not ready to hand off until this consent is recorded.**
- **Q2 Fresh run, never mutate the source.** Continuation creates a new run id with lineage. Rewriting a `done`
  run's state (`reseedRun` + `continue`) was rejected: it falsifies a finalized record and `resumeRun` refuses
  terminal statuses anyway.
- **Q3 Opt-in marker = per-state `startable: true` only.** No workflow-level blanket allow and no CLI override flag:
  an override recreates exactly the silent-skip this task exists to prevent. Engine-owned because the schema is
  strict (mirrors the existing `resumeRerun` field).
- **Q4 DAG deferred.** `kind: dag` refuses `--from`; DAG already has node-level resume (ts-libs 0101) and a
  node-subset start is a different feature. Revisit when a DAG workflow needs a partial re-drive.
- **Q5 Definition drift.** With `--from-run`, the new run executes the *current* definition; the source digest is
  recorded as `continuedFromDigest` and a differing digest prints a warning, not a refusal.
- **Q6 Which KIT states are `startable`** is a knowledge-kit decision, out of scope here. Finding for that follow-up:
  the incident run (`publish_enabled=false`) skipped `safety-review → safety-judge` (`script → safety-review` is
  guarded by `publish_enabled`), and `daily-publish-prep` refuses drafts without a safety stamp. So `--from
  publish-prep` on such a run fails loud — correct behavior; KIT must either mark `safety-review` startable or make
  the safety gate re-runnable standalone.

### Design

**Engine (upstream, ts-libs).** `WorkflowRunOptions.startState?: string`. `StateMachineDriver.run` /
`TransitionFlowDriver.run` pass it into `loop()` as the initial `current` *without* the resume branch (no snapshot,
`resumeMode` undefined, so `lifecycle.enter` persists and on-enter/node actions run). Validation happens in
`WorkflowService.run` before `RunLifecycle.run` creates the row: declared, not terminal/failure, `startable === true`,
kind ≠ dag. Schema: `startable: z.boolean().optional()` beside `resumeRerun`. `config.ts` validation needs no change.

**App service.** `WorkflowAppService.run` (`packages/app/src/services/workflow-service.ts:694`) gains
`startState`/`continuedFrom`. With `continuedFrom`: load the source run (missing → refuse), read its last snapshot's
effective vars, drop `__*` keys, merge under `--vars`, compute digest comparison. Stamp
`{ startState, continuedFrom, continuedFromDigest }` via `RunDao.mergeMetadata` exactly like `dryRun` (`:784`).
Pre-flight refusals run before `existingWorkflowRun`/plan/log setup so no artifact is written.

**CLI.** `apps/cli/src/commands/workflow.ts` `run` command: add `--from <state-id>` and `--from-run <run-id>`; reject
`--from-run` alone; thread both to the async worker argv and into `writeWorkflowPlanArtifact`.

**Plan rendering.** `renderRunPlan(def)` (`packages/app/src/workflow/step-reporter.ts:336`) gets an optional
`startState`; states not reachable from it are rendered with the existing `unattempted` outcome
(`VisibleOutcome`, `:351`) and note `before start state`. No new outcome value.

**Lineage.** `rowToTraceEntry` exposes `startState`/`continuedFrom` from `metadata_json`; the run-log sink's
`.state.json` projection adds them as optional fields (additive; confirm `run-record.ts` / `run-storage.ts` readers
tolerate unknown keys, otherwise bump `schemaVersion`).

**Interactions.** `--steer`: unchanged (boundaries are per action). Paused source run: allowed as `--from-run`
lineage, but the source stays paused — operator uses `workflow continue` if they want it resumed. `onEnter` actions
assuming earlier artifacts: fail loud by design (AC4 second case).

**Routing note (D6).** D6 public-CLI-surface item: the hand-driven publish tail is the compound shell D6 exists to
retire. ADR-051 placement resolved in Q&A Q1.

### Plan

- [x] 0. **Upstream (blocking):** file + land the ts-libs engine task (`startState` option, `startable` schema field,
      refusals, driver tests for state-machine and transition-flow), release ≥ 0.5.16, bump spur-new `catalog`
      pins (currently `^0.5.14`, installed 0.5.14) and run `bun install`.
- [x] 1. Record ADR-051 operator consent in `docs/design/harness-surface-governance.md` (Q&A Q1).
- [x] 2. Write the failure list first (R3 cases, var-precedence edge cases, async/dry-run threading), then implement
      `WorkflowAppService.run` start/continue handling and metadata stamping.
- [x] 3. CLI flags, flag-combination validation, async worker threading, plan rendering of pre-start states.
- [x] 4. Lineage in `workflow trace` (list + single, human + `--json`) and the `.state.json` projection.
- [x] 5. E2E: fixtures for AC1/AC4 under `apps/cli/tests/fixtures/`, isolated project dir, driven through the real
      CLI; keep the receipt directory as the repeatable artifact. Re-run the existing workflow suites for AC7.
- [x] 6. Docs: `--help`, `docs/design/cli-contracts.md` worked example (re-drive the publish tail of a completed daily
      run with `--from-run`), note that KIT's completeness report remains complementary.
- [x] 7. Gate: `bun run spur-check` + `bun run build`; file the knowledge-kit follow-up for Q&A Q6.

### Solution

| File:line | Change |
| --- | --- |
| `packages/app/src/services/workflow-service.ts:330` | `WorkflowRunOptions` gains `startState` and `continuedFrom` — the single authority for both (Q&A Q1); the CLI flags are thin adapters. |
| `packages/app/src/services/workflow-service.ts:746` | Validation runs before any side effect, so a refused start point creates no run row, run record, plan artifact or worker (R3). |
| `packages/app/src/services/workflow-service.ts:749` | Lineage is read up front through `readContinuedFrom`, before the engine service exists, so a missing source run refuses with no side effect. |
| `packages/app/src/services/workflow-service.ts:838` | Metadata stamp `{startState, continuedFrom, continuedFromDigest}` plus the differing-definition warning (R4, Q&A Q5). |
| `packages/app/src/services/workflow-service.ts:819` | `startState` is threaded into the engine run options (fresh-run semantics, R1). |
| `packages/app/src/services/workflow-service.ts:2503` | `rowToTraceEntry` surfaces the lineage so `workflow trace` reports it in list and single, human and `--json` (R7). |
| `packages/app/src/workflow/start-state.ts:41` | `assertStartStateStartable` — the five refusal classes, with the undeclared case listing the valid `startable` ids. |
| `packages/app/src/workflow/start-state.ts:90` | `readContinuedFrom` — source effective vars without `__*` keys, source digest from metadata, never mutating the source run. |
| `packages/app/src/workflow/step-reporter.ts:339` | `preStartStepIds` — forward reachability from the start point, so "precedes" is graph-derived rather than declaration order. |
| `packages/app/src/workflow/step-reporter.ts:402` | `renderRunPlan(def, startState)` renders pre-start steps `unattempted` with note `before start state` — no new outcome value (R4). |
| `packages/app/src/observability/workflow-run-log-sink.ts:248` | The `lineage` fields are projected into the state file additively (R7); a run without `--from` gains neither key. |
| `apps/cli/src/commands/workflow.ts:588` | `--from <state-id>` and `--from-run <run-id>` are declared on the existing `run` verb. |
| `apps/cli/src/commands/workflow.ts:305` | `refuseIllegalStartState` writes the refusal and exits 2 before the launcher plan artifact or worker exists. |
| `apps/cli/src/commands/workflow.ts:381` | `preStartStepIds` marks the pre-start steps `unattempted` in the plan artifact with note `before start state`. |
| `apps/cli/src/commands/workflow.ts:739` | `cmd.push('--from', ...)` threads both flags into the worker argv, so a detached run keeps its start point and lineage (R6). |
| `apps/cli/tests/commands/workflow-run-from.test.ts:156` | E2E AC1–AC7 through the real CLI against fixtures: marker files, refusal matrix, var inheritance, the KIT-shaped publish tail, dry-run, async, and the no-`--from` regression. |
| `packages/app/tests/workflow/start-state.test.ts:109` | Lineage unit tests: effective vars excluding engine-internal keys, unknown source run, absent snapshot. |
| `packages/app/tests/workflow/step-reporter.test.ts:684` | `preStartStepIds` unit coverage across the transition-flow and DAG edge shapes. |
| `docs/design/harness-surface-governance.md:140` | Consent row records the granted `--from` surface, the per-state `startable: true` marker and the 2026-10-05 operator grant. |
| `docs/design/cli-contracts.md:742` | Surface contract: flags, refusal set, var precedence and the worked publish-tail example (R9). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/workflow-service.ts:819` threads the start point into the engine run options; the consumed release is `@gobing-ai/ts-dual-workflow-engine` 0.5.16 (`package.json:35`) carrying ADR-035's `startState` and `startable`. |
| R2 | MET | `apps/cli/src/commands/workflow.ts:588` declares the two flags; a fresh run id is always allocated and the source is never mutated, asserted at `apps/cli/tests/commands/workflow-run-from.test.ts:296`. |
| R3 | MET | `packages/app/src/workflow/start-state.ts:41` holds the five refusal classes; `apps/cli/src/commands/workflow.ts:305` refuses before any side effect at exit 2, asserted at `apps/cli/tests/commands/workflow-run-from.test.ts:191` with unchanged `.spur/memory/runs` and `.spur/run` listings. |
| R4 | MET | `packages/app/src/services/workflow-service.ts:838` stamps the lineage; `packages/app/src/workflow/step-reporter.ts:339` derives the pre-start set so pre-start steps render `unattempted` — asserted at `packages/app/tests/workflow/step-reporter.test.ts:664`. |
| R5 | MET | `packages/app/src/workflow/start-state.ts:90` reads the source's effective vars minus engine-internal keys and `packages/app/src/services/workflow-service.ts:819` applies the defaults-then-inherited-then-caller precedence, asserted at `apps/cli/tests/commands/workflow-run-from.test.ts:296`. |
| R6 | MET | `apps/cli/src/commands/workflow.ts:739` forwards both flags to the detached worker; the launcher plan artifact carries the start state and marks pre-start steps, asserted at `apps/cli/tests/commands/workflow-run-from.test.ts:263`. |
| R7 | MET | `packages/app/src/services/workflow-service.ts:2503` exposes the lineage on the trace entry and `packages/app/src/observability/workflow-run-log-sink.ts:248` projects it into the state file additively, asserted at `apps/cli/tests/commands/workflow-run-from.test.ts:166`. |
| R8 | MET | `apps/cli/tests/commands/workflow-run-from.test.ts:403` asserts the no-flag run gains neither key; the pause/continue, interrupt, `--async`, `--steer` and `--dry-run` suites pass unmodified in this run's full gate (10173 pass / 0 fail). |
| R9 | MET | `docs/design/harness-surface-governance.md:140` records the 2026-10-05 operator consent; `docs/design/cli-contracts.md:742` documents the flags, refusal set, precedence and the worked publish-tail example. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:157` — marker `s2, s3` and `n2, n3`; trace reports `startState: "s2"` |
| AC2 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:191` — every refusal exits 2 with no new run row, record or artifact |
| AC3 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:296` — caller override wins, source var inherited, engine-internal keys dropped, source record byte-identical |
| AC4 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:329-358` — all channel receipts with the safety stamp; failure at `publish-prep` without it |
| AC5 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:263` — dry-run writes no marker and carries both flags; async records the start state and marks the plan |
| AC6 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:166` — single and list trace forms both show the lineage |
| AC7 | MET | test | `apps/cli/tests/commands/workflow-run-from.test.ts:403` — no-flag run has neither key; the pre-existing suites pass unmodified in this run's full gate |
| AC8 | MET | command | `bun run spur-check` exit 0 (10173 pass / 0 fail, both rule presets clean) and `bun run build` exit 0, this run; `docs/help/cmd_workflow.md` and `docs/help2/workflow.md` list both flags |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-review after the residual sweep folded the verdict. The two P3 findings were
re-graded and remediated; both now sit at P4 (advisory) with the fix on the record.
No P1–P3 findings remain.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Duplication / drift — resolved | `packages/app/src/workflow/start-state.ts:41` | The app restates the engine's refusal rule so the async launcher can refuse before it writes a plan artifact; the engine cannot be reached that early. Drift is now a **failing test**, not a silent one: the parity describe at `packages/app/tests/workflow/start-state.test.ts:146` asserts the app refuses and accepts exactly the start points the engine refuses and accepts, for every refusal class on both shapes plus DAG. The residual is cosmetic duplication, which the module header already names as deliberate. |
| P4 | Two source-run reads — resolved | `apps/cli/src/commands/workflow.ts:301` | The CLI pre-check previously used a separate `trace`-based lookup while the app re-read the run for inheritance. The pre-check now goes through the same `readContinuedFrom` seam the app uses, so the existence and readability rule is identical at both reads. A theoretical cross-process race remains (the reads are not one transaction, and a process boundary cannot make them one), but the source is never mutated and the lineage is a snapshot, so there is no correctness consequence. |
| P4 | Structural runtime check | `packages/app/src/workflow/start-state.ts:90` | `readContinuedFrom` discriminates `DbAdapter | WorkflowPersistenceAdapter` with an `'loadRun' in source` test rather than two overloads; invisible to the type system, but the two shapes are disjoint on the tested property. |
| P4 | Warning visibility | `packages/app/src/services/workflow-service.ts:838` | The differing-definition-digest warning travels on the run result's `warnings` array, so a `--silent` or `--quiet` invocation can miss it even though the difference is recorded in metadata. |
| P4 | Test timing | `apps/cli/tests/commands/workflow-run-from.test.ts:277` | The async case polls the run row with a bounded 30x500 ms loop. The plan-artifact assertions before it are deterministic; the poll could flake on a heavily loaded host. |

Residual risk: none blocking. The two findings the sweep reported are remediated —
one by a parity test that pins the two refusal surfaces together, the other by routing
the pre-check through the shared read seam. The remaining P4 rows carry no action.

Disposition: PASS after remediation — no P1–P3 findings; the parity describe and the
shared-seam pre-check are the evidence.

### References

- CLI surface today: `apps/cli/src/commands/workflow.ts` `run` options (~`:518`); existing-run refusal
  `existingWorkflowRun` / `existingRunRefusal` (~`:269`); resume verb `workflow continue` (~`:1062`).
- App service: `packages/app/src/services/workflow-service.ts` — `run` (`:694`), `svc.run` call (`:767`), `dryRun`
  metadata stamp (`:784`), `continuePaused` (`:1224`), `trace`/`traceList` (`:1718`, `:1740`).
- Plan + outcomes: `packages/app/src/workflow/step-reporter.ts:336` (`renderRunPlan`), `:351` (`VisibleOutcome`).
- Run record: `packages/app/src/observability/workflow-run-log-sink.ts:200` (`.state.json` projection, 0925).
- Engine 0.5.15 (ts-libs `packages/dual-workflow-engine`): `src/state-machine.ts:26` (`run` → `initialState` only),
  `:37` (`resume`), `:66–73` (start/snapshot/resumeMode); `src/transition-flow.ts:61–75`; `src/service.ts:61`
  (`run`, no start option), `:181` (`resumeRun`, paused/interrupted only); `src/types.ts:285` (`WorkflowRunOptions`);
  `src/schema.ts:98,138` (`resumeRerun` precedent, `.strict()`).
- KIT workflow: `knowledge-kit/plugins/kk/workflows/kk-daily-ai-voice.yaml` — `quality-control → publish-prep|done`
  guarded by `publish_enabled`; `script → safety-review` guarded by `publish_enabled`.
- Incident evidence: knowledge-kit `.spur/context/learnings.md:184` "Daily 20261002 publish-tail forensics
  (20261003)"; completeness artifact from `daily-publish-classify`.
- ADR-051 (`docs/00_ADR.md:489`) and `docs/design/harness-surface-governance.md`.
- Related upstream: ts-libs 0092 (fork/join `type: parallel`) and 0101 (DAG resume replay fix, released 0.5.15).

### History

- 2026-10-05T18:31:25.546Z backlog → todo (system)
- 2026-10-05T19:11:46.795Z todo → wip (system)
- 2026-10-05T19:11:47.797Z wip → testing (system)
- 2026-10-05T19:12:38.499Z testing → done (system)
- 2026-10-05T22:05:38.323Z done → wip (system)
- 2026-10-05T22:07:44.700Z wip → testing (system)
- 2026-10-05T22:22:17.242Z testing → done (system)

