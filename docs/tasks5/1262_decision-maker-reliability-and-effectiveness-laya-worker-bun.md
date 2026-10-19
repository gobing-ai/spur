---
schema_version: 1
name: "Decision-maker reliability and effectiveness: laya worker bundling, decide ledger gap, task-pipeline decision rework"
status: todo
template: issue
created_at: 2026-10-19T18:00:11.379Z
updated_at: "2026-10-19T20:40:26.810Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
feature_id: P1
---

## 1262. Decision-maker reliability and effectiveness: laya worker bundling, decide ledger gap, task-pipeline decision rework

### Background

Evidence-led audit (2026-10-19) of how spur-new uses the ts-libs decision family
(`@gobing-ai/ts-ai-decision` hub; makers `typesafe`, `fm-local`, `laya-local`, `clef`). Sources:
`.spur/spur.db` (`system_events`, `decision_logs`, `action_runs`), `.spur/run/*.decision`,
`~/.config/spur/config.yaml`, and the installed bundle (spur 0.4.15, single `spur.js`).

This task fixes the four defects the audit verified and reworks the task-pipeline decision points
whose data shows they add no information. Outcome measurement (were the decisions right?) is task
1263; executor-failure rescue is task 1264.

Verified findings:

1. **`laya-local` always fails under the bundled CLI.** ts-laya-mlx resolves its worker as
   `join(import.meta.dir, '..', 'worker', 'laya_worker.py')`. Bundled into `spur.js`, that path
   points at `node_modules/@gobing-ai/worker/laya_worker.py`, which does not exist, so every ask
   fails in about 100 ms with `reason: error`. knowledge-kit `kk-item-quality` on laya-local:
   0/161 accepted. The unbundled ts-libs source answers `ok` at 0.79, so the model and Python env
   are fine. The installed `@gobing-ai/ts-laya-mlx` 0.5.30 already accepts a `workerScript`
   option; spur never passes it.
2. **Worktree runs lose every decision row.** Workflow decide steps do emit
   (`decide.ts` → `DecisionService.decide` with `bus` and `decisionLog`), but runs started by
   `/sp:dev-runall` execute inside `spur-new-runall-*` worktrees and write to the worktree DB.
   `persist-out` copies `runs` plus `CHILD_TABLES` only, and that list leaves out
   `system_events` and `decision_logs`, so the rows are discarded with the worktree. Data: 42
   task-pipeline runs between 2026-10-10 and 2026-10-19 have decide rows in `action_runs` but
   zero `system_events` and zero `decision_logs` rows, e.g. run
   `581829c8-9032-4b60-ac0e-b9f181388ab0` (workdir `spur-new-runall-1254-batch6-80c4`, three
   decide steps, triage answered by clef at 0.1408, zero events). Main-workdir run
   `runall-1189-bbf29eb7` recorded 7 events normally.
3. **Fallback rows carry no error text.** When the hub serves a fallback (`reason: error`), it
   returns no cause, so `decision.failure` and `decision_logs.error` stay empty. Finding 1 took a
   manual repro to diagnose. ts-libs task `0117` (ADR-040) adds `DecisionResult.error`.
4. **Task-pipeline decisions mostly serve the fallback or say nothing new.**

   | Decision | Maker | Calls | Accepted | Confidence | Observation |
   |---|---|---|---|---|---|
   | `task-triage` | clef | 36 | 2 | 0.07–0.45 | A 3-way size guess that duplicates the deterministic pre-guard (>400 lines or a sensitive path → safety) |
   | `failure-class` | typesafe | 13 | 0 | ≤ 0.66 | Runs on every gate visit; on a green gate its evidence file is 0 bytes |
   | `review-failure-class` | fm-local | 15 | 15 | 1.0 | Always `fix`, which is also the fallback: zero information |

   The catalog `config/decisions/task-pipeline.yaml` has one-line criteria and no `instructions`
   template, and its header still says "No workflow references this catalog yet".
5. **Sampled-maker confidence is a unanimity vote.** For `fm-local` (and the planned ts-libs
   `llm-agent`), confidence is `1 − H(p)/ln(n)` over k samples: with two options, 2-of-3 gives
   0.08. At Spur's 0.8 floor an accept means "every sample agreed", which is why
   `review-failure-class` reads 15/15 at 1.0.
6. **The `decisions.maker` config comment lists exactly four makers.** It goes stale whenever the
   registry gains one.

Corrections to the first draft of this task (kept so nobody reopens them): `gate-evidence` is
reachable (dropped), the history-anatomy shell-out is deliberate (dropped), and the ledger gap is
the worktree transfer, not a missing bus wire.

### Requirements

- [ ] R1. **laya worker ships with the bundle.** `build:bundle` copies `laya_worker.py` from the installed `@gobing-ai/ts-laya-mlx` to `apps/cli/worker/laya_worker.py`, and `worker/` joins `apps/cli/package.json` `files`. `DecisionService` passes `workerScript` to both `ownLayaClient` calls (`decision-service.ts:235,361`) when the shipped file exists beside the bundled config root and `LAYA_WORKER_SCRIPT` is unset in the env; otherwise it passes nothing (source runs keep the package default).
- [ ] R2. **Worktree decision rows survive persist-out.** `transferRunTables` also copies, for every persisted run id, the `system_events` rows and `decision_logs` rows with that `run_id`: insert-if-absent by `id`, and `system_events.sequence` reassigned in source order above the target's `MAX(sequence)` (it is the global ledger cursor). The async-spawn fallback at `run.ts:571` passes the same bus as the sync path. The four residual main-workdir runs (Root Cause) get a repro or a recorded explanation in `## Solution`.
- [ ] R3. **Fallback rows carry the cause.** When the hub returns a fallback with `error: { name, message }` (ts-libs task `0117`, ADR-040), `DecisionService.decide` passes `redactAndBound(name + ": " + message, configuredSecretValues(env), 512)` to `invocation.fail({ error })` and sets `log.error` to the raw text (the sink redacts it). Bump the `@gobing-ai/ts-ai-decision` catalog pin to the first release exposing `DecisionResult.error`.
- [ ] R4. **Skip decides that have nothing to read.** Catalog decide options gain `skipWhenEvidenceEmpty?: boolean`. When true and every `evidence` path is missing or 0 bytes, the action writes a degraded row (`value` = catalog fallback, `degraded: true`, `reason: 'no-evidence'`, `backend: null`, `confidence: null`), calls no maker and emits no events. `DecideDegradedReason` gains `'no-evidence'`. `failure-class` in task-pipeline sets it.
- [ ] R5. **Triage asks one narrow question, or none.** Keep the deterministic pre-guard (`task-pipeline.yaml:440-450`) unchanged. Replace catalog `task-triage` (choice low/standard/high) with `task-semantic-risk` (noul, fallback `true`): "does this diff change behaviour a reviewer must reason about beyond the diffstat?". `false` projects the fast lane, `true` or a fallback projects standard. If the evidence bar in Q&A is not met, delete the decide step and the catalog entry instead; the lane is then the pre-guard result or standard.
- [ ] R6. **Retire `review-failure-class`.** Remove the decide step (`task-pipeline.yaml:697-706`) and its catalog entry. Replace the two review guards that read its row (`:1022-1030` stop, `:1040-1048` fix) with one guard: review status file exists and is not `PASS`, under the attempt cap → `remediate`. The remediate log projection at `:568` keys on the same status file instead of the deleted `.decision` file.
- [ ] R7. **Catalog text the model can use.** Each remaining entry in `config/decisions/task-pipeline.yaml` gets an `instructions` template that embeds `${params.instructions}` and states what the evidence is, plus criteria that name observable signals (file kinds, error classes), not adjectives. Replace the stale header comment with a short accurate one.
- [ ] R8. **No hard-coded maker list in config docs.** The `decisions.maker` / `decisions.makers` comment at `config/config.global.yaml:152-170` says the value is any registered maker name and points to `spur decision status`; it no longer enumerates four names.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the bundled CLI finds the laya worker (req: R1)
  Given `bun run build:bundle` has run in apps/cli
  When the packed file list and the resolved laya client options are inspected
  Then `worker/laya_worker.py` is in the package and `workerScript` points at it

Scenario: AC2 — a worktree run's decision rows reach the project ledger (req: R2)
  Given a worktree database holding one run with decision.start, decision.failure and decision.end rows and one decision_logs row
  When persist-out transfers the run into a target database whose ledger already has rows
  Then all four rows exist in the target with their ids, and the copied events carry sequences above the target's previous maximum in source order

Scenario: AC3 — a fallback names its cause without leaking secrets (req: R3)
  Given a maker that fails with a message containing a configured secret value
  When a catalog decision serves the fallback
  Then the decision.failure payload and the decision_logs error column name the error class and message with the secret redacted

Scenario: AC4 — an empty-evidence decide makes no maker call (req: R4)
  Given a catalog decide step with skipWhenEvidenceEmpty and a 0-byte evidence file
  When the step runs with the decision switch on
  Then the result row has reason no-evidence and the fallback value, the maker double was never called, and no decision events were emitted

Scenario: AC5 — triage keeps the deterministic floor (req: R5)
  Given a diffstat of 450 changed lines
  When the gate state runs
  Then the lane is safety and no triage decision is made

Scenario: AC6 — a non-PASS review routes to remediation without a decision (req: R6)
  Given a review status of FAIL and an attempt count under the cap
  When the review transitions are evaluated
  Then the run moves to remediate, and no review-failure-class decision file is read or written

Scenario: AC7 — shipped catalogs carry instructions (req: R7, R8)
  Given the bundled task-pipeline catalog and config.global.yaml
  When the catalog test loads them
  Then every task-pipeline decision has an instructions template using params.instructions, and the maker comment lists no fixed maker set
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-19T18:55:23.820Z

- **Q: Which feature owns this task?** A: P1 (Spur decision production readiness). R2 and R3 restore P1 scenarios R8 (events persist to the ledger) and R14 (every invocation is in the decision log) for worktree runs; R4–R7 are adoption-slice corrections. The task scenarios are fix-specific, so `ac_altitude: task-local`.
- **Q: Evidence bar for R5 (`task-semantic-risk`), per the P1 entry condition?** A (proposed; the operator may override in this Q&A before R5 starts): at least 20 samples replayed in the project DB with `spur decision run task-semantic-risk --evidence .spur/run/<wbs>-diffstat.json --evidence <task spec>` over historical tasks that have a recorded review, served by a reachable maker (`no-backend` samples do not count); accepted rate ≥ 0.5; and no accepted `false` on a task whose `## Review` recorded a P1 or P2 finding. Bar not met → take R5's delete branch. Record the replay table (wbs, value, reason, confidence, review top severity) in `## Solution`.
- **Q: Why remove `review-failure-class` instead of switching makers?** A: on two options with fallback `fix`, the only answer that changes the route is `stop`, and 15/15 runs said `fix`. A review that should stop already ends via the attempt cap or a denial at the approval step. Removing it is behaviour-preserving for every recorded run.
- **Q: Why not make the gate's `failure-class` conditional in YAML?** A: `onEnter` actions have no conditionals (`task-pipeline.yaml:520-524` comment). A per-action option is the smallest seam, and other catalog decides can reuse it.
- **Q: Does R1 need a ts-libs release?** A: no. 0.5.30 (installed) accepts `workerScript`. The env variable `LAYA_WORKER_SCRIPT` and the readable missing-script error land in the next ts-libs release; R1 does not rely on them.
- **Q: What if no ts-ai-decision release exposes `DecisionResult.error` when this task runs?** A: implement R1, R2, R4–R8, leave R3 unchecked, and state that in `## Review`. Do not patch `node_modules` or vendor the hub.
- **Q: Dropped from the first draft?** A: retiring `gate-evidence` (it is reachable) and converting the history-anatomy shell-out (deliberate). Do not reopen either.

#### Q&A entry — 2026-10-19T20:40:26.809Z

- **Q: Which feature owns this task?** A: P1 (Spur decision production readiness). R2 and R3 restore P1 scenarios R8 (events persist to the ledger) and R14 (every invocation is in the decision log) for worktree runs; R4–R7 are adoption-slice corrections. The task scenarios are fix-specific, so `ac_altitude: task-local`.
- **Q: Evidence bar for R5 (`task-semantic-risk`), per the P1 entry condition?** A (operator-confirmed 2026-10-19; binding): at least 20 samples replayed in the project DB with `spur decision run task-semantic-risk --evidence .spur/run/<wbs>-diffstat.json --evidence <task spec>` over historical tasks that have a recorded review, served by a reachable maker (`no-backend` samples do not count); accepted rate ≥ 0.5; and no accepted `false` on a task whose `## Review` recorded a P1 or P2 finding. Bar not met → take R5's delete branch. Record the replay table (wbs, value, reason, confidence, review top severity) in `## Solution`.
- **Q: Why remove `review-failure-class` instead of switching makers?** A: on two options with fallback `fix`, the only answer that changes the route is `stop`, and 15/15 runs said `fix`. A review that should stop already ends via the attempt cap or a denial at the approval step. Removing it is behaviour-preserving for every recorded run.
- **Q: Why not make the gate's `failure-class` conditional in YAML?** A: `onEnter` actions have no conditionals (`task-pipeline.yaml:520-524` comment). A per-action option is the smallest seam, and other catalog decides can reuse it.
- **Q: Does R1 need a ts-libs release?** A: no. 0.5.30 (installed) accepts `workerScript`. The env variable `LAYA_WORKER_SCRIPT` and the readable missing-script error land in the next ts-libs release; R1 does not rely on them.
- **Q: What if no ts-ai-decision release exposes `DecisionResult.error` when this task runs?** A: implement R1, R2, R4–R8, leave R3 unchecked, and state that in `## Review`. Do not patch `node_modules` or vendor the hub.
- **Q: Dropped from the first draft?** A: retiring `gate-evidence` (it is reachable) and converting the history-anatomy shell-out (deliberate). Do not reopen either.

### Design

**Frozen names**

| Item | Name |
|---|---|
| Decide option | `skipWhenEvidenceEmpty?: boolean` on `CatalogDecideOptionsSchema` (`decide.ts:98-116`) |
| Degraded reason | `'no-evidence'` appended to `DecideDegradedReason` (`decide.ts:22`) |
| New catalog decision | `task-semantic-risk` (type `noul`, fallback `true`, `minConfidence` 0.8 inherited) |
| Bundle step | `scripts/commands/bundle-laya-worker.ts`, dispatched from `scripts/spur-dev.ts` as `bundle-laya-worker` |
| Shipped path | `apps/cli/worker/laya_worker.py` (package-root `worker/`) |

**R1 resolution.** `workerScript = join(dirname(bundledConfigRoot()), 'worker', 'laya_worker.py')` when `bundledConfigRoot()` (`packages/config/src/bundled-config.ts:31`) is non-null, the file exists, and `env.LAYA_WORKER_SCRIPT` is unset. In a source checkout the root is the repo `config/`, the sibling `worker/` does not exist, and nothing is passed. Use ts-runtime path and FileSystem helpers, not `node:path`/`node:fs` directly, per the platform-API rule. Resolve once per service, not per ask.

**R2 transfer.** Extend `transferRunTables` with a second list, `LEDGER_TABLES = ['system_events', 'decision_logs']`, copied after the child tables for each persisted id. They stay out of `CHILD_TABLES` on purpose: that list also drives the `ownsChildren` bookkeeping test at `run-transfer.ts:145`, and ledger rows must not change that verdict. `system_events` inserts use the DAO's `INSERT … SELECT COALESCE(MAX(sequence),0)+1` shape (`system-event-dao.ts:277-293`) with an explicit null sequence, in source `sequence` order. `decision_logs` uses the existing `insertIfAbsentOps`.

**R4 order.** In `executeCatalog`, the skip check runs after option validation and the decision-switch check, and before the evidence read and `DecisionService.decide`. The disabled path keeps its current behaviour (degraded row, no events). Write the row through `degradedCatalogRow` (`decide.ts:332-350`) with the new reason.

**R5/R6 routing.** Lane projection: `jq -r 'if .value == false then "fast" else empty end'` on `.spur/run/$wbs-semantic-risk.decision`, replacing `.value == "low"` at `task-pipeline.yaml:469`; the route-log reasons are renamed to match. Review routing keeps declaration order: done → denied → cap → remediate (status exists and ≠ PASS) → fail-closed `always`.

**Anti-patterns**
- Do not patch `import.meta.dir` in the bundle or post-process `spur.js`.
- Do not add `system_events`/`decision_logs` to `CHILD_TABLES` (it changes conflict grading).
- Do not copy worktree `sequence` values verbatim (they collide with the target cursor).
- Do not delete only the `review-failure-class` step: the guards then find no row and fail closed to `failed-check` on every non-PASS review.
- Do not hard-code an evidence bar or confidence threshold in code; the catalog's `minConfidence` and the Q&A bar own them.
- Do not add a new decision maker, dependency or config key for this task.

### Plan

1. **R2 first (it unblocks measurement).** Write the failing E2E in `packages/domain/tests/dao/run-transfer.test.ts`: a source DB with one run plus `system_events` and `decision_logs` rows, a target with existing events → assert AC2. Implement `LEDGER_TABLES` in `packages/domain/src/dao/run-transfer.ts`. Pass the bus at `apps/cli/src/commands/workflow/run.ts:571`. Investigate the four residual runs (`runs.started_at` versus the 1095 landing commit date; `git log --format=%ci` on `decide.ts`) and record the finding.
2. **R4.** Failing test in `packages/app/tests/workflow/` for AC4 using a maker double; then the schema option, the reason literal and the skip branch in `packages/app/src/workflow/actions/decide.ts`; set `skipWhenEvidenceEmpty: true` on `failure-class` in `config/workflows/task-pipeline.yaml`.
3. **R1.** Add `scripts/commands/bundle-laya-worker.ts` with a sibling `.test.ts` (pattern: `bundle-config.ts`), wire it in `scripts/spur-dev.ts:56-58,106-118` and `apps/cli/package.json` `build:bundle` + `files`. Resolve `workerScript` in `packages/app/src/decision/decision-service.ts` for both laya clients. AC1 test: run the bundle step into a temp dir and assert the file plus the resolved option.
4. **R3.** After the ts-ai-decision bump: failing test for AC3 in `packages/app/tests/decision/`; map `outcome.error` in `decision-service.ts:526-532`.
5. **R6.** Remove the decide step and catalog entry; rewrite the review guards and the `:568` projection; update `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts` and update the review entries in `packages/app/tests/workflow/fixtures/guard-parity-baseline.json` (an intentional routing change: `guard-parity.test.ts` compares topology and guard booleans against that fixture, so edit the changed transitions only and say so in `## Solution`). AC6 via the existing task-pipeline guard tests.
6. **R5.** Run the Q&A replay and record the table. Then either add `task-semantic-risk` and rewire the lane projection, or delete the triage decide; AC5 via the guard tests.
7. **R7/R8.** Rewrite catalog text and header; update the `config/config.global.yaml` comment; extend the catalog test for AC7. Update `docs/design/decision-catalog.md` and `plugins/sp/skills/spur-cli/references/decision.md` where they name `task-triage` or `review-failure-class`.
8. Run `bun run spur-check` and `bun run build`; `git status` shows only this task's files.

### Root Cause

| Defect | Cause | Evidence |
|---|---|---|
| laya-local dead in the bundle | ts-laya-mlx derives its worker path from `import.meta.dir`; the bundle relocates the module, and spur passes no `workerScript` | `node_modules/.bun/@gobing-ai+ts-laya-mlx@0.5.30+…/src/worker-client.ts:515,522`; `packages/app/src/decision/decision-service.ts:235,361` (`ownLayaClient({ env })` with no `workerScript`) |
| Worktree decision rows lost | `transferRunTables` copies `runs` + `CHILD_TABLES`; `system_events` and `decision_logs` are not in the list | `packages/domain/src/dao/run-transfer.ts:61-68,122-177`; caller `packages/app/src/services/worktree-persist.ts:84-92` |
| No error text on fallback | the hub's `DecisionResult` has no error field, so `invocation.fail` gets none on the non-throw path | `packages/app/src/decision/decision-service.ts:526-532` (fail without `error`) vs `:552-558` (throw path sets it) |
| `failure-class` on empty evidence | the decide runs in `gate.onEnter` unconditionally; onEnter actions have no conditionals | `config/workflows/task-pipeline.yaml:520-531` |
| `review-failure-class` no information | sampled maker + 2 options + fallback equal to the only observed answer | `config/workflows/task-pipeline.yaml:697-706,1022-1048`; `.spur/run/*-review-failure-class.decision` (15/15 `fix`, 1.0) |

Residual, not yet explained: main-workdir runs `c35ef140…`, `e70fa727…`, `5ea1240e…`
(2026-10-12) and `runall-1151-1165-af998a` also have zero events. They may predate the event
wiring (task 1095) or reveal a second path. R2 requires a repro or a recorded explanation. A
second, minor gap: the async-spawn fallback at `apps/cli/src/commands/workflow/run.ts:571` calls
`makeWorkflowService(context, options.json)` without the bus that `run.ts:709-712` and
`continue.ts:155` pass.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature P1 `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md` (scenarios R8, R14; entry condition and evidence bar in § Scope).
- Code: `packages/app/src/workflow/actions/decide.ts:22,98-116,300-350,359-496`; `packages/app/src/decision/decision-service.ts:227-245,351-372,413-560`; `packages/app/src/decision/decision-events.ts:74-80,200-222`; `packages/domain/src/dao/run-transfer.ts:61-68,122-177`; `packages/domain/src/dao/system-event-dao.ts:265-293`; `packages/app/src/services/worktree-persist.ts:84-92`; `packages/config/src/bundled-config.ts:31-55`; `apps/cli/src/commands/workflow/run.ts:571,709-712`; `apps/cli/src/commands/workflow/continue.ts:144-155`.
- Workflow/catalog: `config/workflows/task-pipeline.yaml:440-469,520-531,568,697-706,957-990,1022-1048`; `config/decisions/task-pipeline.yaml`; `config/config.global.yaml:149-170`.
- Build: `apps/cli/package.json` (`files`, `build:bundle`); `scripts/commands/bundle-config.ts`; `scripts/spur-dev.ts:56-58,106-118`.
- ts-libs: `packages/laya-mlx/README.md` § Host prerequisites item 3; ADR-040 and task `0117` (`DecisionResult.error`); `docs/design/llm-agent-decision-backend.md` § Confidence granularity.
- Data: `.spur/spur.db` (`runs.workdir`, `action_runs`, `system_events`, `decision_logs`); `.spur/run/*.decision`.
- Related: task 1263 (outcome pairing over these rows), task 1264 (executor-failure rescue).

### History
