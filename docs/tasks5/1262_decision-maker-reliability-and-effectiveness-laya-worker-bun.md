---
schema_version: 1
name: "Decision-maker reliability and effectiveness: laya worker bundling, decide ledger gap, task-pipeline decision rework"
status: done
template: issue
created_at: 2026-10-19T18:00:11.379Z
updated_at: "2026-10-20T02:39:59.795Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
feature_id: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1262-verdict.json
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

- [x] R1. **laya worker ships with the bundle.** `build:bundle` copies `laya_worker.py` from the installed `@gobing-ai/ts-laya-mlx` to `apps/cli/worker/laya_worker.py`, and `worker/` joins `apps/cli/package.json` `files`. `DecisionService` passes `workerScript` to both `ownLayaClient` calls (`decision-service.ts:235,361`) when the shipped file exists beside the bundled config root and `LAYA_WORKER_SCRIPT` is unset in the env; otherwise it passes nothing (source runs keep the package default).
- [x] R2. **Worktree decision rows survive persist-out.** `transferRunTables` also copies, for every persisted run id, the `system_events` rows and `decision_logs` rows with that `run_id`: insert-if-absent by `id`, and `system_events.sequence` reassigned in source order above the target's `MAX(sequence)` (it is the global ledger cursor). The async-spawn fallback at `run.ts:571` passes the same bus as the sync path. The four residual main-workdir runs (Root Cause) get a repro or a recorded explanation in `## Solution`.
- [x] R3. **Fallback rows carry the cause.** When the hub returns a fallback with `error: { name, message }` (ts-libs task `0117`, ADR-040), `DecisionService.decide` passes `redactAndBound(name + ": " + message, configuredSecretValues(env), 512)` to `invocation.fail({ error })` and sets `log.error` to the raw text (the sink redacts it). Bump the `@gobing-ai/ts-ai-decision` catalog pin to the first release exposing `DecisionResult.error`.
- [x] R4. **Skip decides that have nothing to read.** Catalog decide options gain `skipWhenEvidenceEmpty?: boolean`. When true and every `evidence` path is missing or 0 bytes, the action writes a degraded row (`value` = catalog fallback, `degraded: true`, `reason: 'no-evidence'`, `backend: null`, `confidence: null`), calls no maker and emits no events. `DecideDegradedReason` gains `'no-evidence'`. `failure-class` in task-pipeline sets it.
- [x] R5. **Triage asks one narrow question, or none.** Keep the deterministic pre-guard (`task-pipeline.yaml:440-450`) unchanged. Replace catalog `task-triage` (choice low/standard/high) with `task-semantic-risk` (noul, fallback `true`): "does this diff change behaviour a reviewer must reason about beyond the diffstat?". `false` projects the fast lane, `true` or a fallback projects standard. If the evidence bar in Q&A is not met, delete the decide step and the catalog entry instead; the lane is then the pre-guard result or standard.
- [x] R6. **Retire `review-failure-class`.** Remove the decide step (`task-pipeline.yaml:697-706`) and its catalog entry. Replace the two review guards that read its row (`:1022-1030` stop, `:1040-1048` fix) with one guard: review status file exists and is not `PASS`, under the attempt cap → `remediate`. The remediate log projection at `:568` keys on the same status file instead of the deleted `.decision` file.
- [x] R7. **Catalog text the model can use.** Each remaining entry in `config/decisions/task-pipeline.yaml` gets an `instructions` template that embeds `${params.instructions}` and states what the evidence is, plus criteria that name observable signals (file kinds, error classes), not adjectives. Replace the stale header comment with a short accurate one.
- [x] R8. **No hard-coded maker list in config docs.** The `decisions.maker` / `decisions.makers` comment at `config/config.global.yaml:152-170` says the value is any registered maker name and points to `spur decision status`; it no longer enumerates four names.

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

| File:line | Change |
|---|---|
| `packages/domain/src/dao/run-transfer.ts:76` | `LEDGER_TABLES = ['system_events','decision_logs']`, kept out of `CHILD_TABLES` so the `ownsChildren` conflict grading is unchanged. |
| `packages/domain/src/dao/run-transfer.ts:108` | `ledgerOps()` copies one run's ledger rows per persisted run: `decision_logs` verbatim by id, `system_events` renumbered above the target's `MAX(sequence)` in source order (the cursor is global, so verbatim sequences collide). |
| `packages/domain/src/dao/run-transfer.ts:222` | `transferRunTables` appends the ledger ops to the same per-run batch (atomic with the run row). |
| `apps/cli/src/commands/workflow/run.ts:572` | The async-spawn fallback builds the same `EventBus` + system-event ledger bridge the sync path builds, and hands it to `makeWorkflowService`. |
| `packages/app/src/workflow/actions/decide.ts:110` | `CatalogDecideOptionsSchema.skipWhenEvidenceEmpty?: boolean`. |
| `packages/app/src/workflow/actions/decide.ts:466` | Skip branch: after option/service validation, before the evidence read — writes the degraded row with `reason: 'no-evidence'`, calls no maker, emits no events. `evidenceIsEmpty()` (line 310) treats an unreadable path as empty and an undeclared evidence set as *not* empty. |
| `packages/app/src/workflow/actions/decide.ts:360` | `degradedCatalogRow` accepts the new `'no-evidence'` reason; `packages/app/src/workflow/decide.ts:22` adds it to `DecideDegradedReason`. |
| `packages/app/src/decision/decision-service.ts:197` | `bundledLayaWorkerScript()` resolves `worker/laya_worker.py` beside the bundled config root, once per service (line 271) and for both laya clients (serving + probe); `LAYA_WORKER_SCRIPT` and a source checkout both yield `undefined`, so the package default still applies there. |
| `scripts/commands/bundle-laya-worker.ts` | New bundle step: resolves the installed `@gobing-ai/ts-laya-mlx` package root through `packages/app` (bun hoists it under `node_modules/.bun/`) and copies its `worker/laya_worker.py` to `apps/cli/worker/`. Wired into `scripts/spur-dev.ts` (`bundle-laya-worker`) and `apps/cli/package.json` (`build:bundle`, `files: ["worker"]`); `.gitignore` keeps the generated copy untracked. |
| `packages/app/src/decision/decision-service.ts:581` | A hub fallback carrying `DecisionResult.error` now passes `redactAndBound("Name: message", configuredSecretValues(env), 512)` to `invocation.fail({ error })` and sets `log.error` to the raw text (the sink redacts it). `@gobing-ai/ts-ai-decision@0.5.32` already exposes `DecisionResult.error` (`@gobing-ai/ts-ai-decision` lines 64-65), so R3 needed no pin bump. |
| `config/workflows/task-pipeline.yaml:456` | The gate's lane decide is now `task-semantic-risk` (noul, fallback `true`, `skipWhenEvidenceEmpty: true`). |
| `config/workflows/task-pipeline.yaml:478` | Lane projection reads `.value == false or .value == "no"` → `fast`; route-log reasons renamed (`fast:semantic-risk mechanical change`, `safety:deterministic-high`, `safety:standard lane`). The deterministic pre-guard is untouched. |
| `config/workflows/task-pipeline.yaml:536` | `failure-class` sets `skipWhenEvidenceEmpty: true` (a green gate's findings file is 0 bytes). |
| `config/workflows/task-pipeline.yaml:696` | The `review-failure-class` decide is removed; `:574` projects the review verdict on the **status file** instead of the deleted `.decision` row. |
| `config/workflows/task-pipeline.yaml:1031` | One review→remediate guard replaces the two decision rows: review status exists and is not `PASS` (the cap edge above it still bounds the loop). No stop edge remains — a review that must stop ends at the approval denial or the cap. |
| `config/decisions/task-pipeline.yaml` | `task-triage` retired, `task-semantic-risk` added (noul, fallback `true`), `review-failure-class` removed, `failure-class` rewritten. Every remaining entry has an `instructions` template that embeds `${params.instructions}` and states what the evidence is, plus criteria naming observable signals (file kinds, error classes) instead of adjectives. Header comment replaced. |
| `config/config.global.yaml:157` | The `decisions.maker` comment no longer enumerates four makers: the value is any registered maker name, `spur decision status` is the authority, and the example override names `task-semantic-risk`. |
| Tests | `packages/domain/tests/dao/run-transfer.test.ts` (AC2 + idempotence), `packages/app/tests/workflow/actions/decide-catalog.test.ts` (AC4 + negative), `packages/app/tests/decision/laya-worker-script.test.ts` (AC1 resolution), `scripts/commands/bundle-laya-worker.test.ts` (AC1 bundle + packed file list), `packages/app/tests/decision/decision-service.test.ts` (AC3 redaction), `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts` (AC5, re-keyed to the noul lane), plus the fixtures/tests the retire-and-replace touched: `task-pipeline-proof-chain.test.ts`, `task-pipeline-proportional-routing.test.ts`, `shipped-workflows-catalog-decide.test.ts`, `guard-parity-baseline.json`, `apps/cli/tests/commands/decision.test.ts`. |

**R5 evidence replay (Q&A bar: ≥20 reachable-maker samples, accepted ≥ 0.5, no accepted `false` on a P1/P2 review).** Served by `fm-local` against `spur decision run task-semantic-risk` with `--evidence .spur/run/<wbs>-diffstat.json --evidence <task spec>`, in the project DB (`cwd` = invoking tree), over historical tasks that carry both a diffstat and a recorded `## Review`.

| WBS | Review top | value | confidence | reason |
|---|---|---|---|---|
| 0958 | P1 | true | 1.0 | accepted |
| 0962 | P1 | true | 1.0 | accepted |
| 0965 | P1 | true | 1.0 | accepted |
| 0966 | P1 | true | 1.0 | accepted |
| 0983 | P2 | true | 1.0 | accepted |
| 0984 | P2 | true | 1.0 | accepted |
| 1008 | P1 | true | 1.0 | accepted |
| 1043 | P1 | true | 1.0 | accepted |
| 1057 | P1 | true | 1.0 | accepted |
| 1070 | P1 | true | 1.0 | accepted |
| 1071 | P1 | true | 1.0 | accepted |
| 1073 | P1 | true | 1.0 | accepted |
| 0956 | P4 | true | 1.0 | accepted |
| 0975 | P4 | true | 1.0 | accepted |
| 0977 | P4 | true | 1.0 | accepted |
| 0980 | P4 | true | 1.0 | accepted |
| 0998 | P4 | true | 1.0 | accepted |
| 1020 | P3 | true | 1.0 | accepted |
| 1024 | P4 | true | 1.0 | accepted |
| 1045 | P4 | true | 1.0 | accepted |
| 1046 | P4 | true | 1.0 | accepted |
| 1047 | P4 | true | 1.0 | accepted |
| 1050 | P4 | true | 1.0 | accepted |
| 1052 | P3 | true | 1.0 | accepted |

24 samples, accepted rate 1.0, zero accepted `false` on a P1/P2 review — the recorded bar is met, so R5 keeps `task-semantic-risk` and rewires the projection rather than taking the delete branch. **Caveat for 1263:** every sample answered `true`, so the fast lane was not projected once; the answer equals the catalog fallback on this corpus, exactly the "adds no information" pattern R6 retired. The sample is all real code changes (each earned a gate and a review), so it holds little negative class — the classifier is not proven wrong, but its routing value is unproven and 1263's outcome pairing owns measuring whether `false` ever appears in production.

**R2 residual runs (Root Cause): explained, no second bus gap remains.** `c35ef140…`, `e70fa727…`, `5ea1240e…` (2026-10-12) and `runall-1151-1165-af998a` (2026-10-10) each own `runs` rows, 25–278 `action_runs` including `decide` nodes, and **zero** `system_events` / `decision_logs` rows — while six same-day runs in the same DB hold 7–17 events each. That signature is exactly the transfer gap: the rows that reached the invoking tree are the ones `persist-out` copied (`runs` + `CHILD_TABLES`), and the ledger tables were dropped with the worktree. The second gap named in Root Cause (the async-spawn fallback constructing the service without a bus) produces the same all-events-missing shape for a fallback-launched run and is closed at `run.ts:572`. Both paths are covered by AC2's test; the four runs predate both fixes and are not re-generated.

**Deviations from the Design, recorded.** (1) The lane projection reads `.value == "no"` as well as `.value == false`: the frozen schemaVersion-1 row stores the noul **label** (`"yes"`/`"no"`), not a boolean, so the Design's `.value == false` alone would never have projected the fast lane. (2) `packages/app` did not typecheck on the base commit (`chore(project): upgrade project dependencies` broke three `effectiveMaker` call sites against `ts-ai-decision` 0.5.32's `MakerRef = string | readonly string[]`); repaired with `firstMaker()` (`decision-service.ts:181`, the head of a maker chain, which is the maker asked first) so the pipeline gate can be green. No shipped catalog declares a chain, so routing is unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/bundle-laya-worker.ts:44-56` copies the installed worker (fails loudly when missing); `scripts/spur-dev.ts:115` dispatches `bundle-laya-worker`; `apps/cli/package.json:35` adds `worker` to `files` and `apps/cli/package.json:53` runs the step in `build:bundle`; `packages/app/src/decision/decision-service.ts:197-206` resolves `worker/laya_worker.py` beside the bundled config root, with `LAYA_WORKER_SCRIPT` taking precedence; `.gitignore:82` ignores `/apps/cli/worker` |
| R2 | MET | `packages/domain/src/dao/run-transfer.ts:76` adds `system_events` + `decision_logs` to `LEDGER_TABLES`; `packages/domain/src/dao/run-transfer.ts:114-134` copies per run with sequences renumbered above the target `MAX(sequence)`; `apps/cli/src/commands/workflow/run.ts:569-577` passes the async-spawn fallback the same bus + ledger bridge; `packages/domain/tests/dao/run-transfer.test.ts:254` (AC2) and `:304` (idempotent re-persist) |
| R3 | MET | `packages/app/src/decision/decision-service.ts:576-594` maps `outcome.error` to a redacted `invocation.fail({error})` (bounded at 512) and the raw `log.error`; installed pin `@gobing-ai/ts-ai-decision@0.5.32` (`package.json:33`) exposes `error?: DecisionErrorInfo` on results at `node_modules/.bun/@gobing-ai+ts-ai-decision@0.5.32+b2d869f83d0e4e20/node_modules/@gobing-ai/ts-ai-decision/dist/hub.d.ts:38`, `:51`, `:65`; `packages/app/tests/decision/decision-service.test.ts:377` (AC3) |
| R4 | MET | `skipWhenEvidenceEmpty` is set on `config/workflows/task-pipeline.yaml:544` (`failure-class`) and `config/workflows/task-pipeline.yaml:463` (`task-semantic-risk`); decide action option / size check / degraded row are pinned by `packages/app/tests/workflow/actions/decide-catalog.test.ts:199` (no maker call, no events) and `:242` (non-empty evidence still calls) |
| R5 | MET | `config/workflows/task-pipeline.yaml:454-464` runs the `task-semantic-risk` noul decide and `config/workflows/task-pipeline.yaml:469-471` projects `false`/`no` to fast and everything else to standard; deterministic pre-guard unchanged; replay table recorded in the task `## Solution`; `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:282` (AC5) and `:295`, `:303` fail-safe cases |
| R6 | MET | the `review-failure-class` decide is gone; `config/workflows/task-pipeline.yaml:1040-1051` is the single review→remediate guard (status file exists and != PASS, with the cap guard above it); `config/workflows/task-pipeline.yaml:574-584` projects the remediate log from `$__runId-gate.status` + the review answer file, not the deleted `.decision`; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:460` (no decide in review) and `:525-527` (FAIL under cap → `remediate`, no `.decision` file) |
| R7 | MET | `config/decisions/task-pipeline.yaml` instructions templates embed `${params.instructions}` with observable-signal criteria; `docs/design/decision-catalog.md:88-95` records current state; `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:90`, `:101`, `:112` |
| R8 | MET | `config/config.global.yaml:157-165` says the maker is any registered name and names `spur decision status` as the authority; it lists no fixed four-name set |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — the bundled CLI finds the laya worker (req: R1) | MET | test | `scripts/commands/bundle-laya-worker.test.ts:24` (non-empty worker copied) and `:34` (`files` carries `worker/`); `packages/app/tests/decision/laya-worker-script.test.ts:34` (bundled root resolves), `:39` and `:44` (source checkout / unresolved root pass nothing). Run this session: 2 pass + 14 pass |
| AC2 — a worktree run's decision rows reach the project ledger (req: R2) | MET | test | `packages/domain/tests/dao/run-transfer.test.ts:254` copies three events + one log above the target cursor in source order; `:304` re-persist is idempotent. Run this session: 9 pass |
| AC3 — a fallback names its cause without leaking secrets (req: R3) | MET | test | `packages/app/tests/decision/decision-service.test.ts:377` — the `decision.failure` payload and the `decision_logs` error both name the class + message with the secret `[REDACTED]`. Run this session within 84 pass |
| AC4 — an empty-evidence decide makes no maker call (req: R4) | MET | test | `packages/app/tests/workflow/actions/decide-catalog.test.ts:199` (degraded `no-evidence` row, zero maker calls, zero events) and the negative `:242`. Run this session within 84 pass |
| AC5 — triage keeps the deterministic floor (req: R5) | MET | test | `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:282` — 450-line diffstat → `safety`, no lane decision. Run this session within 84 pass |
| AC6 — a non-PASS review routes to remediation without a decision (req: R6) | MET | test | Fix pass added `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:525-527`: with review status FAIL under the attempt cap, `firstPassingEdge('review')` is `remediate` and no `review-failure-class.decision` file exists; structural `:460` pins that review has no decide. Run this session within 84 pass |
| AC7 — shipped catalogs carry instructions (req: R7, R8) | MET | test | `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:90`, `:101`, `:112` load the bundled catalog (decidable type, criteria, fallback, noul vocabulary); `config/config.global.yaml:157-165` lists no fixed makers. Run this session: 14 pass (with laya-worker-script) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the full task diff against R1–R8 with the SECUA lenses plus the two edges the diff creates
(worktree ledger transfer, and a pipeline that is itself being edited). Two findings were raised in
review and both are FIXED in this diff; one residual is carried as P4.

| Priority | Location | Finding | Disposition |
|---|---|---|---|
| P3 | `packages/app/src/workflow/actions/decide.ts:466` | The skip branch was placed before the reserved-parameter check at `packages/app/src/workflow/actions/decide.ts:459`, so a malformed decide with empty evidence would have written a degraded row instead of failing the action. Option validation must precede any evidence work. | FIXED — reserved-param check moved above the skip; the "params.instructions is reserved" test still passes |
| P3 | `packages/domain/src/dao/run-transfer.ts:108` | The ledger copy queried both tables unconditionally; a source worktree DB older than the ledger migration at `drizzle/0052_spur_cli_decision_logs.sql:1` would throw and make persist-out refuse teardown on a missing table. | FIXED — each ledger table is skipped when it is absent from the catalogue (`packages/domain/src/dao/run-transfer.ts:112`); AC2's test still covers the present-table path |
| P4 | `packages/app/src/decision/decision-service.ts:181` | The new head-of-chain helper collapses a catalog maker **chain** to its first name for `EffectiveMaker.name` (the chain type is declared at `@gobing-ai/ts-ai-decision` lines 60 (`MakerRef`)); a future chained catalog would report only the first maker while the hub still walks the chain. No shipped catalog declares a chain, so no behaviour changes today. Out of R-scope; recorded for the maker-chain slice. | ACCEPTED |

Correctness notes checked, no finding raised: the ledger copy is inside the same per-run batch, so a
teardown can never leave a run row whose ledger is half-copied; `system_events.sequence` is renumbered
above the target maximum in source order and stays idempotent (AC2 test asserts both); the review
guard replacement keeps the declaration order `done → denied → cap → remediate → always-fail`, so the
cap still bounds the loop before remediation (AC6 test); `skipWhenEvidenceEmpty` runs only for catalog
decides and never for the inline form; the laya `workerScript` resolution is read once per service and
is bypassed by `LAYA_WORKER_SCRIPT` (AC1 test); the bundled worker stays untracked (`.gitignore`) and
reaches the tarball through `files: ["worker"]` (AC1 test).

Residual risk. The `task-semantic-risk` replay answered `true` on 24/24 samples, so the fast lane was
never projected (see `## Solution`); 1263's outcome pairing is where that gets measured. Two evidence
gaps stay open by design: no acceptance snapshot exists for the `decision_logs` transfer against a
real pre-migration worktree DB (covered by the table-absent guard and the in-memory AC2 test), and the
laya worker resolution is proven at the resolver seam, not by a packaged-host run.

Verdict: PASS
Confidence: MEDIUM

### References

- Feature P1 `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md` (scenarios R8, R14; entry condition and evidence bar in § Scope).
- Code: `packages/app/src/workflow/actions/decide.ts:22,98-116,300-350,359-496`; `packages/app/src/decision/decision-service.ts:227-245,351-372,413-560`; `packages/app/src/decision/decision-events.ts:74-80,200-222`; `packages/domain/src/dao/run-transfer.ts:61-68,122-177`; `packages/domain/src/dao/system-event-dao.ts:265-293`; `packages/app/src/services/worktree-persist.ts:84-92`; `packages/config/src/bundled-config.ts:31-55`; `apps/cli/src/commands/workflow/run.ts:571,709-712`; `apps/cli/src/commands/workflow/continue.ts:144-155`.
- Workflow/catalog: `config/workflows/task-pipeline.yaml:440-469,520-531,568,697-706,957-990,1022-1048`; `config/decisions/task-pipeline.yaml`; `config/config.global.yaml:149-170`.
- Build: `apps/cli/package.json` (`files`, `build:bundle`); `scripts/commands/bundle-config.ts`; `scripts/spur-dev.ts:56-58,106-118`.
- ts-libs: `packages/laya-mlx/README.md` § Host prerequisites item 3; ADR-040 and task `0117` (`DecisionResult.error`); `docs/design/llm-agent-decision-backend.md` § Confidence granularity.
- Data: `.spur/spur.db` (`runs.workdir`, `action_runs`, `system_events`, `decision_logs`); `.spur/run/*.decision`.
- Related: task 1263 (outcome pairing over these rows), task 1264 (executor-failure rescue).

### History

- 2026-10-19T23:01:21.619Z todo → wip (system)
- 2026-10-19T23:15:47.609Z wip → testing (system)
- 2026-10-19T23:17:19.399Z testing → done (system)

