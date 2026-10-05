---
schema_version: 1
name: Start or resume a workflow run from a chosen state
status: backlog
template: feature-impl
created_at: 2026-10-04T06:57:19.805Z
updated_at: "2026-10-05T04:47:47.885Z"
feature_id: D6

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

- [ ] R1. **Engine dependency.** Consume an engine release (≥ 0.5.16, upstream ts-libs task) that adds
  `WorkflowRunOptions.startState` and a per-state/per-node `startable: boolean` schema field, with fresh-run
  semantics: the start state's on-enter/node action **executes**, no snapshot is loaded, `transitionsTaken` starts at
  0, and an undeclared / terminal / failure / non-`startable` start state, or any `kind: dag` workflow, is refused
  with an `FSMError` before a run row is created. Bump the spur-new `catalog` pins accordingly.
- [ ] R2. `spur workflow run <file> --from <state-id>` starts a **fresh** run at that state. `--from-run <run-id>`
  (only valid together with `--from`) records lineage to a prior run and inherits its vars. Run ids are never
  reused: the source run is never mutated and the 0901 R1 existing-run refusal stays.
- [ ] R3. Refusals are loud and side-effect free: unknown state (message lists the valid `startable` ids), state not
  marked `startable`, terminal/failure state, DAG workflow, `--from-run` without `--from`, unknown source run id. Each
  exits non-zero (validation → 2) before any run row, run-record file, plan artifact, or async worker is created.
- [ ] R4. Nothing before the start state executes or is recorded as done. Run-row `metadata_json` carries
  `startState` (and `continuedFrom`, `continuedFromDigest` when `--from-run` is given); the run-start plan marks
  states that precede the start point as `unattempted` with note `before start state` — never `completed`.
- [ ] R5. Var precedence: workflow defaults < source run's last-snapshot effective vars (only with `--from-run`,
  excluding engine/runtime-internal `__*` keys) < `--vars`. Guards, transitions, `terminalReason`, failure states,
  `iterationBound` and `onError` policies behave exactly as in a normal run from that state onward.
- [ ] R6. `--dry-run --from` walks the graph from the start state without executing actions; `--async --from` threads
  `startState`/`continuedFrom` to the worker and the worker's digest/plan check covers them.
- [ ] R7. Lineage is visible: `spur workflow trace` (list and `trace <run-id>`, human and `--json`) shows
  `startState` and `continuedFrom`; the `.state.json` projection gains the same optional fields additively.
- [ ] R8. Absent `--from`, behavior and output are byte-for-byte unchanged: pause/`continue`, interrupt, `--async`,
  `--steer`, run memory, the two-file run record, and no `startState` key in metadata.
- [ ] R9. Documented surface: ADR-051 consent recorded in `docs/design/harness-surface-governance.md`; `--from` /
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

- [ ] 0. **Upstream (blocking):** file + land the ts-libs engine task (`startState` option, `startable` schema field,
      refusals, driver tests for state-machine and transition-flow), release ≥ 0.5.16, bump spur-new `catalog`
      pins (currently `^0.5.14`, installed 0.5.14) and run `bun install`.
- [ ] 1. Record ADR-051 operator consent in `docs/design/harness-surface-governance.md` (Q&A Q1).
- [ ] 2. Write the failure list first (R3 cases, var-precedence edge cases, async/dry-run threading), then implement
      `WorkflowAppService.run` start/continue handling and metadata stamping.
- [ ] 3. CLI flags, flag-combination validation, async worker threading, plan rendering of pre-start states.
- [ ] 4. Lineage in `workflow trace` (list + single, human + `--json`) and the `.state.json` projection.
- [ ] 5. E2E: fixtures for AC1/AC4 under `apps/cli/tests/fixtures/`, isolated project dir, driven through the real
      CLI; keep the receipt directory as the repeatable artifact. Re-run the existing workflow suites for AC7.
- [ ] 6. Docs: `--help`, `docs/design/cli-contracts.md` worked example (re-drive the publish tail of a completed daily
      run with `--from-run`), note that KIT's completeness report remains complementary.
- [ ] 7. Gate: `bun run spur-check` + `bun run build`; file the knowledge-kit follow-up for Q&A Q6.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
