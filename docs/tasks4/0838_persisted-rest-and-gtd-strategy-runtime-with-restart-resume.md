---
schema_version: 1
name: Persisted rest and GTD strategy runtime with restart resume
status: done
template: feature-impl
created_at: 2026-09-12T04:53:38.725Z
updated_at: "2026-09-13T08:04:45.062Z"
feature_id: G62
priority: P1
tags:
  - g6-program

dependencies: ["0836", "0837"]
---

## 0838. Persisted rest and GTD strategy runtime with restart resume

### Background

Rest and GTD exist only as a prototype controller
(`apps/cli/tests/fixtures/g6/strategy-prototype.ts`, exercised by
`apps/cli/tests/commands/g6-strategy-prototype.test.ts`, 23 tests / 109 assertions). Production has no
strategy primitive at all: nothing holds dispatch, nothing selects next work, and nothing survives a
restart.

Robin approved the semantics on 2026-09-11: `rest` accepts input, starts nothing — including
previously queued assignments that have not started — and lets running work finish; `gtd` selects
already-authorized eligible work. `gtd` is a project dispatch policy, not a replacement for
`/sp:dev-gtd` or `task-pipeline.yaml`: it selects within the existing readiness, dependency, and
verification gates and may explain a hold, never bypass a gate
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity").

The design is also explicit that starting the Board must not silently reset the active strategy.

**Premise check — the gate owners this task must call, not reimplement.**

- Candidate enumeration: `TaskService.list(filters)` (`packages/app/src/services/task-service.ts:1682`)
  returning `TaskSummary { wbs, name, status, filePath, frontmatter }` (`:319-326`).
- Dependency satisfaction: the L4 prerequisite rule in
  `packages/app/src/services/task-check.ts:1343` — "`Prerequisite <wbs> is <status>; task <root> is not
  ready until it is done`", including the transitive form and the cycle guard at `:1328`.
- Verification and advancement: `config/workflows/task-pipeline.yaml`. This task never advances a task.
- `packages/app/src/services/task-readiness.ts` is **refine**-readiness (the `--depth ready` checklist),
  not dispatch readiness. Do not mistake it for the gate here.

**Premise check — there is no persistence and no generic key/value store.** The domain DAOs are all
typed and purpose-built (`packages/domain/src/dao/`): no settings table exists to hang a strategy on.
Task 0836 adds `project_claims` for slot ownership; strategy must outlive every claim, so it cannot
live there.

**Premise check — "authorized" has no carrier today.** Nothing in the task frontmatter or the corpus
marks a task as eligible for autonomous dispatch, which is why R3/R4 need one named explicitly rather
than assumed.

### Requirements

- **R1** — `rest` and `gtd` are persisted per project and restored on restart; starting the Board does
  not reset the active strategy. A project with no persisted strategy defaults to `rest`.
- **R2** — `rest`: input is accepted and results ingested, no new dispatch starts (including queued but
  unstarted assignments), running work finishes and holds its slot until reconciliation.
- **R3** — `gtd`: dispatches only authorized, ready, dependency-satisfied tasks, ordered by priority
  then WBS, entirely within the existing gate owners named in Background.
- **R4** — Every skipped candidate records an actionable hold reason from a closed vocabulary
  (`unauthorized`, `not-ready`, `unmet-dependency`, `no-idle-instance`, `executor-unavailable`,
  `rest-after-drain`).
- **R5** — Strategy selection is a small declared extension point: a frozen record of named strategies.
  No dynamic plugin loader, no second workflow engine, no separate backlog model.
- **R6** — On restart, persisted strategy, fleet ownership, and in-flight assignments are reconciled
  before any new work is accepted for dispatch.

### Acceptance Criteria

```gherkin
Feature: Persisted rest and GTD strategy runtime with restart resume

  @core
  Scenario: R3 — GTD dispatches only eligible authorized work
    Given strategy gtd and a mix of authorized, unauthorized, unready, and blocked tasks
    When the orchestrator selects next work
    Then only authorized, ready, dependency-satisfied tasks dispatch, ordered by priority then WBS
    And every skipped task records an actionable hold reason

  @core
  Scenario: R2 — Rest drains without starting new work
    Given running work and queued unstarted assignments
    When the strategy changes to rest
    Then no further dispatch starts, queued-unstarted assignments do not begin
    And running work finishes and reconciles, keeping its slot until reconciliation

  @core
  Scenario: R6 — Restart resumes persisted state before dispatching
    Given a persisted strategy, fleet, and in-flight assignments
    When the runtime restarts
    Then strategy and ownership are restored and reconciled before any new dispatch
    And starting the Board does not reset the active strategy
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:22:25.590Z

- **Strategy persistence — CLOSED: a one-row-per-project `project_strategy` table at prefix `0045`.**
  `fleet.json` is operator-authored declaration and a runtime writer would fight the operator's editor;
  `project_claims` rows expire while the strategy must not; there is no generic settings table in
  `packages/domain/src/dao/`. One row, four columns, additive and droppable.
- **Default strategy — CLOSED: `rest`.** An unconfigured project must start nothing. Defaulting to
  `gtd` would mean installing this feature silently begins dispatching coding agents against a
  worktree.
- **"Authorized" carrier — CLOSED: the task tag `fleet:auto`.** Frontmatter `tags` already exists and is
  writable through `spur task update`, so opting a task in needs no new store and no new verb, and the
  default is never-dispatch. A status value would collide with the lifecycle FSM; a separate
  authorization table would be a second corpus.
- **`strategy_version` increments on every set — CLOSED.** 0837 fences on `decision.strategyVersion <
  current`. If a re-set to the same name left the version unchanged, a decision taken before a
  rest→gtd→rest cycle would still look current.
- **Extension point shape — CLOSED: a `Record<StrategyName, Strategy>` literal.** R5 asks for a
  declared extension point, not an extensible one: adding a strategy is a typed code change, which is
  what keeps the closed `StrategyName` union honest. A loader would need discovery, versioning, and a
  trust boundary for something that has exactly two implementations.
- **Dependency readiness — CLOSED: injected, sourced from `task-check.ts:1343`.** A second parse of
  `dependencies[]` here would drift from the checker that gates the corpus, and the transitive walk and
  cycle guard already exist there.
- **Hold-reason type name — CLOSED: `DispatchHoldReason`, distinct from G61 0834's `HoldReason`.**
  Delivery state and dispatch state are the separation G61 exists to preserve; one shared union would
  re-conflate them.
- **Deferred (owner: 0839).** Event-driven wakeup; this task exposes `selectNext` and `resume` and does
  not schedule itself.
- **Deferred (owner: G63 0840/0844).** Rendering strategy and hold reasons on the Board.

### Design

**WHAT.** A `StrategyRuntime` that (a) persists the active strategy per project, (b) asks a named
strategy for dispatch decisions, and (c) reconciles before accepting work at startup. The strategies
themselves are two small pure functions.

**WHY a separate table rather than `fleet.json` or `project_claims`.** Strategy is *runtime* state an
operator flips; `fleet.json` is operator-authored declaration and a runtime writer would fight their
editor. `project_claims` rows are per-slot and disappear on expiry, while the strategy must survive
with nobody holding anything. It is one row per project — the smallest thing that satisfies R1.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/domain/src/migrations.ts` | `PROJECT_STRATEGY_SCHEMA_SQL`, step `0045_spur_cli_project_strategy` |
| `packages/domain/src/dao/project-strategy-dao.ts` (new) | `ProjectStrategyDao` |
| `packages/app/src/services/strategy-runtime.ts` (new) | `StrategyRuntime`, `STRATEGIES`, hold reasons |
| `apps/cli/src/commands/projects.ts` | `spur projects list --fleet` shows the active strategy |

**Frozen names — storage.** Migration `0045_spur_cli_project_strategy`, file
`drizzle/0045_spur_cli_project_strategy.sql`:

```sql
CREATE TABLE IF NOT EXISTS project_strategy (
    project_path     TEXT    PRIMARY KEY,
    strategy         TEXT    NOT NULL,
    strategy_version INTEGER NOT NULL DEFAULT 1,
    updated_at       INTEGER NOT NULL
);
```

`strategy_version` increments on **every** `setStrategy` call, including a no-op re-set of the same
name, so 0837's `stale-strategy` fence is monotonic and never depends on the value having changed.

**Frozen names — runtime.**

```ts
// packages/app/src/services/strategy-runtime.ts
type StrategyName = 'rest' | 'gtd';
const DEFAULT_STRATEGY: StrategyName = 'rest';
const FLEET_AUTO_TAG = 'fleet:auto';

type DispatchHoldReason =
    | 'unauthorized' | 'not-ready' | 'unmet-dependency'
    | 'no-idle-instance' | 'executor-unavailable' | 'rest-after-drain';

interface StrategyContext {
    projectPath: string;
    strategyVersion: number;
    ownerEpoch: number;                       // from the orchestrator claim (0836)
    candidates: TaskSummary[];                // TaskService.list({ status: 'todo' })
    idleInstances: ResolvedFleetMember[];     // enabled, not currently holding a run (0835)
    dependencyBlocked: (wbs: string) => string | null; // null = satisfied; else blocking wbs
}
interface DispatchHold { wbs: string; reason: DispatchHoldReason; detail?: string; }
interface StrategyResult { decisions: DispatchDecision[]; holds: DispatchHold[]; }
interface Strategy { readonly name: StrategyName; select(ctx: StrategyContext): StrategyResult; }

const STRATEGIES: Readonly<Record<StrategyName, Strategy>> = { rest: restStrategy, gtd: gtdStrategy };

class StrategyRuntime {
    getStrategy(projectPath: string): Promise<{ name: StrategyName; version: number }>;
    setStrategy(projectPath: string, name: StrategyName): Promise<number>;   // returns new version
    resume(projectPath: string): Promise<ResumeReport>;                       // R6
    selectNext(projectPath: string): Promise<StrategyResult>;
}
interface ResumeReport { strategy: StrategyName; version: number; orchestrator: OrchestratorBinding;
                         unresolved: UnresolvedDelivery[]; reconciled: boolean; }
```

**`rest` (R2).** `select` returns `{ decisions: [], holds: candidates.map(c => ({ wbs: c.wbs, reason:
'rest-after-drain' })) }`. It starts nothing — including a queued-but-unstarted assignment, which is
why the hold is recorded per candidate rather than as one global flag. `rest` does **not** touch
messages (input keeps arriving), does **not** cancel running work, and does **not** release a held
write slot; the slot is released by the run's own completion or by TTL expiry (0837).

**`gtd` (R3, R4).** For each candidate, evaluated in this order, first failure recorded as the hold and
the candidate skipped:

1. `frontmatter.tags` does not contain `FLEET_AUTO_TAG` → `unauthorized`.
2. `status !== 'todo'` → `not-ready`.
3. `ctx.dependencyBlocked(wbs)` returns a blocking WBS → `unmet-dependency`, `detail` = that WBS.
4. No idle instance remains → `no-idle-instance`.
5. The chosen instance's executor does not resolve → `executor-unavailable`.

Survivors are sorted by `frontmatter.priority` ascending as a string (`P0` < `P1` < … — the existing
vocabulary, `task-service.ts:1872`) then by `wbs` ascending, and become `DispatchDecision` values
carrying `ctx.strategyVersion` and `ctx.ownerEpoch` for 0837's fences. A candidate with no `priority`
sorts last, deterministically, under the sentinel `'P9'`.

**`dependencyBlocked` (R3).** Supplied by the caller, backed by the **existing** L4 prerequisite rule
(`packages/app/src/services/task-check.ts:1343`) — including its transitive walk and cycle guard. The
strategy never parses `dependencies[]` itself; injecting it as a function is what keeps a second
implementation of the readiness rule from existing.

**Resume (R6), strict order, nothing dispatches until it finishes.**

1. `ProjectStrategyDao.get(projectPath)`; absent → persist `DEFAULT_STRATEGY` at version 1 (R1).
2. `FleetService.resolveOrchestrator(projectPath)` (0836) — a non-`bound-online` state returns a
   `ResumeReport` with `reconciled: false` and **no dispatch**.
3. `DeliveryReconciler.reconcile()` (G61 task 0834) for unresolved deliveries, and
   `CoordinationRunDao` receipts (0833) for in-flight runs.
4. Only then may `selectNext` be called.

The Board reads state through `resume`/`getStrategy` and never writes on open — that is R1's "starting
the Board does not reset the active strategy".

**Anti-patterns — do not implement.**

- Do not advance, transition, or verify a task here. `task-pipeline.yaml` owns advancement; a strategy
  only selects or holds.
- Do not reimplement dependency readiness — inject `dependencyBlocked` from `task-check.ts:1343`.
- Do not add a plugin loader, a registry file, or a dynamic `import()` for strategies. `STRATEGIES` is a
  record literal of two entries; a third is a code change (R5).
- Do not build a separate backlog, queue, or task model — candidates are `TaskSummary` values.
- Do not default a project to `gtd`. An unconfigured project must start nothing.
- Do not let `rest` cancel running work, drop messages, or release a held slot.
- Do not silently skip a candidate: every skip produces a `DispatchHold` (R4).
- Do not reuse G61 0834's `HoldReason` type — that one is delivery-state; this is dispatch. The names
  are deliberately distinct.
- Do not store strategy in `fleet.json`, in `project_claims`, or in process memory.

**Handoff.** 0839 wakes this runtime on events instead of polling and surfaces the current
`DispatchHold` set as the idle reason. G63 0840 renders the active strategy in the header and 0844
renders `rest-after-drain` as `rest-held`.

### Plan

1. Add `PROJECT_STRATEGY_SCHEMA_SQL` to `packages/domain/src/migrations.ts`, register step
   `0045_spur_cli_project_strategy`, add `drizzle/0045_spur_cli_project_strategy.sql`. (R1)
2. Add `packages/domain/src/dao/project-strategy-dao.ts` with `get` / `set` (version increments on
   every set) and export it from the DAO index. (R1, R4 fencing input for 0837)
3. Add `packages/app/src/services/strategy-runtime.ts` with the frozen types, `DEFAULT_STRATEGY`,
   `FLEET_AUTO_TAG`, and the `STRATEGIES` record literal. (R5)
4. Implement `restStrategy.select` — empty decisions, one `rest-after-drain` hold per candidate. (R2)
5. Implement `gtdStrategy.select` — the five-step precedence, then priority-then-WBS ordering, emitting
   `DispatchDecision` values carrying `strategyVersion` and `ownerEpoch`. (R3, R4)
6. Implement `StrategyRuntime.resume` in the strict four-step order, returning `ResumeReport` and
   refusing to dispatch when the orchestrator is not `bound-online`. (R6)
7. Surface the active strategy in `spur projects list --fleet` and its `--json`. (R1)
8. Tests, `packages/app/tests/services/strategy-runtime.test.ts`: gtd with a mixed candidate set emits
   exactly the authorized/ready/dependency-satisfied subset in priority-then-WBS order with one hold
   per skip and one hold reason each; rest emits zero decisions with `rest-after-drain` per candidate
   and leaves a running run and its slot untouched; `setStrategy` increments the version even when the
   name is unchanged; `resume` restores a persisted strategy, reconciles first, and returns
   `reconciled: false` without dispatching when the orchestrator is offline; an absent row defaults to
   `rest`. (R1–R6)
9. `cd packages/app && bun test tests/services/strategy-runtime.test.ts`, then `bun run spur-check`.

### Solution

**SPEC DRIFT CORRECTION (mandatory note):** the frozen spec's migration id `0045_spur_cli_project_strategy` is STALE — 0045 is taken by 0836 (`0045_spur_cli_project_claims`). Shipped as **`0046_spur_cli_project_strategy`** + `drizzle/0046_spur_cli_project_strategy.sql` everywhere; frozen spec text untouched (0833/0836 renumber precedent).

**Change map (all files; line refs at implementation time):**

| File | Change |
| --- | --- |
| `packages/domain/src/migrations.ts:328` | `PROJECT_STRATEGY_SCHEMA_SQL` (one row per project; `strategy_version` bumps on every set); wired into `CLI_SCHEMA_SQL` (:347); step `0046_spur_cli_project_strategy` registered (:1443) |
| `drizzle/0046_spur_cli_project_strategy.sql` (new) | byte-compatible regenerate-on-release mirror (0045 precedent) |
| `packages/domain/src/dao/project-strategy-dao.ts` (new) | `ProjectStrategyDao.get` (:46) / `set` (:62) — `set` is ONE guarded upsert with `RETURNING` (the `ProjectClaimDao.claim` one-statement precedent; no post-write re-read), version increments on EVERY set incl. same-name re-sets; exported from `packages/domain/src/dao/index.ts:35` |
| `packages/app/src/services/strategy-runtime.ts` (new) | frozen vocabulary (`StrategyName`, `DEFAULT_STRATEGY`, `FLEET_AUTO_TAG`, `DispatchHoldReason`, `DispatchHold`, `StrategyContext`, `StrategyResult`, `Strategy`, `STRATEGIES` :179); `restStrategy` :84 (zero decisions, one `rest-after-drain` hold per candidate); `gtdStrategy` :104 (five-step precedence, priority-then-WBS sort, decisions carry `strategyVersion`+`ownerEpoch`, `requiresWrite` = member `writeCapable`); `StrategyRuntime` :218 — `getStrategy` :225 (pure read; absent → rest v1), `setStrategy` :238, `resume` :252 (strict R6 order: persist default when absent → `resolveOrchestrator`, non-`bound-online` returns `reconciled: false` with no dispatch → `DeliveryReconciler.reconcile()` → ready), `selectNext` :278 (assembles ctx: candidates from `TaskService.list({status:'todo'})`, idle = enabled minus the LIVE write-slot holder (self-heals at TTL — no sticky liveness), `ownerEpoch` from the live orchestrator claim else 0 (fences every live claim), injected dep gate resolved per candidate up front); `DispatchDecision` reused from 0837's write-slot-service (never redefined) |
| `packages/app/src/services/task-check.ts:1385` | `firstBlockingPrerequisite(tasksDir, wbs)` — the L4 prerequisite rule as a value: reuses the SAME `checkDependencyReadiness` walk (:1306, now additively returns the first blocking wbs; finding pushes unchanged, sole existing caller unaffected). Declared `dependencies[]` edges only — the set `dev-runall`/`dev-verifyall` topo-sort on. This IS the production source of the injected `dependencyBlocked` (Q&A: injected, sourced from the corpus checker, never a second parse) |
| `packages/app/src/index.ts:221` | exports: `StrategyRuntime`, `STRATEGIES`, strategies, frozen types |
| `apps/cli/src/commands/projects.ts:170` | `list --fleet` reads `ProjectStrategyDao` per project (read-only); text line `strategy: <name> (v<n>)` / `rest (default)` / `unavailable (…)` (:262); `--json` gains `strategy` + `strategyError` (:175) |
| `docs/help/cmd_projects.md:55`, `plugins/sp/skills/spur-cli/references/projects.md:48` | `--fleet` docs gain the strategy surface |

**Design notes.** Idle-instance derivation: "enabled, not currently holding a run" reads the live `write` claim (`ProjectClaimDao.get` + expiry) — the only TTL'd, self-healing run-holder signal; `coordination_runs.status='running'` rows are sticky after a crash and would wedge a member forever, so they are deliberately not consulted (disclosed). Instance assignment happens in candidate-iteration order inside the frozen five-step, THEN survivors sort — instances are fungible in v1; no role matching exists to assign by.

**Heartbeat wiring:** 0838 ships no run loop (Q&A defers scheduling/wakeup to 0839), so no `ProjectClaimDao.heartbeat` call site exists yet — `selectNext`/`resume` are the dispatch/interval seams 0839's loop will heartbeat from. The orchestrator claim written at `claim()` time carries `heartbeat_at = claimed_at`; nothing in this task churns claim rows.

**Advisory dispositions (carried from 0837's review):**
- **(a) WriteSlotService.claim fence-read/claim TOCTOU + holder-identity belt-and-braces — DISPOSITIONED, not churned.** The holder-identity check after the atomic claim is already present (0837 `claim()` post-claim guard). The residual read-then-claim window (orchestrator epoch advancing between fence check and write claim) is inherent to non-transactional fencing; closing it would rewrite 0836's frozen single-statement dao contract. The window is bounded by the 30s TTL and fenced at the consuming ends: `validateResult` rejects stale-owner results and 0839's dispatch loop can re-fence immediately before launch, which is where a re-check actually shrinks the window for the launch decision. No change made.
- **(b) 0834 P3 multi-receipt `listByMessageId` tie-break test — ADDRESSED.** Two tests added in `packages/app/tests/services/delivery-reconciler.test.ts` ("0838 advisory" describe): older `errored` superseded by newer `verified` → omitted as finished; older `verified` superseded by newer `errored` → `delivery-failed` naming the newest run. Pins newest-evidence-wins determinism from the reconcile caller side; no production change (behavior was already deterministic and sensible).
- **(c) `changes()` probes in `heartbeat`/`release` — DISPOSITIONED: retained.** Wrap-residual fail-safe per the advisory; churned for nothing.

**Not done (frozen anti-patterns honored):** no plugin loader (STRATEGIES is a two-entry record literal), no second backlog (candidates are `TaskSummary`), no dependency re-parse (injected from task-check), no task advancement, `rest` never cancels running work or releases a held slot, no Board write on open, `HoldReason` (0834) vs `DispatchHoldReason` (0838) kept distinct.

#### 2026-09-13 forced re-audit

Re-audit repair: sort candidates before allocating scarce instances. GTD selection reconciles first and returns holds for offline ownership or unresolved deliveries. Declared fleet loops retain queued work during rest. This supersedes the former capacity-before-sort disposition. Managed GTD draining still bypasses selection/claim/heartbeat/fenced completion; the task is not certified complete by this re-audit.

Current per-requirement evidence and residuals are in Testing and `docs/reports/g62-verifyall-2026-09-13.md`. Earlier implementation-time anchors and completion statements above are historical; this re-audit supersedes them.

#### G62 closure — 2026-09-13

This implementation supersedes the unresolved gaps recorded in the preceding re-audit. The production loop dispatches selected tasks through the existing AgentService and dev-run pipeline. Authorization, strict task readiness, dependencies, priority/WBS, assignee/role compatibility and live instance capacity gate selection. Strategy and ownership are checked again after executor resolution. Rest accepts queued input without starting it; running work reconciles before releasing its slot. Prior task receipts prevent duplicate dispatch after restart. Absent strategy insertion cannot overwrite a concurrent strategy change.

Regression evidence is recorded in the refreshed Testing section. New changes are intentionally uncommitted for the operator's next step.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/strategy-runtime.test.ts:325` — rest is the default and Board reads do not write; `packages/app/tests/services/strategy-runtime.test.ts:419` — restart restores persisted strategy without resetting its version; `bun run spur-check` (exit 0). Measured repository coverage: 98.99% lines, 99.21% functions. Evidence: G62 closure `.spur/run/g62-verifyall-20260913/spur-check-shippable.log` line 1 through EOF. Replaces Evidence: G62 re-audit `.spur/run/0838-verify-answer.txt` line 1 through EOF and `.spur/run/0838-verdict.json` line 1 through EOF; prior artifacts are preserved under the closure run directory. |
| R2 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:254` — queued assignments remain unstarted; `packages/app/tests/services/strategy-runtime.test.ts:527` — a rest switch holds subsequent tasks while running work retains its slot through reconciliation; `packages/app/tests/services/strategy-runtime.test.ts:598` — heartbeat prevents the running slot from expiring; `bun run spur-check` (exit 0). |
| R3 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `packages/app/tests/services/strategy-runtime.test.ts:177` — priority/WBS sorting happens before capacity allocation; `packages/app/tests/services/strategy-runtime.test.ts:568` — running readers consume capacity and prior task receipts cannot be redispatched; `bun run spur-check` (exit 0). |
| R4 | MET | `packages/app/tests/services/strategy-runtime.test.ts:198` — every skipped candidate gets one actionable hold from the closed vocabulary; `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `bun run spur-check` (exit 0). |
| R5 | MET | `packages/app/src/services/strategy-runtime.ts:184` declares only rest and gtd; task enumeration/checking and the existing agent runner are reused without another workflow engine or backlog; `bun run spur-check` (exit 0). |
| R6 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `packages/app/tests/services/strategy-runtime.test.ts:471` — unresolved deliveries gate dispatch; `packages/app/tests/services/strategy-runtime.test.ts:568` — unfinished task/run receipts survive restart and prevent repeat dispatch; `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — GTD dispatches only eligible authorized work | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `packages/app/tests/services/strategy-runtime.test.ts:177` — priority/WBS sorting happens before capacity allocation; `packages/app/tests/services/strategy-runtime.test.ts:568` — running readers consume capacity and prior task receipts cannot be redispatched; `bun run spur-check` (exit 0). |
| R2 — Rest drains without starting new work | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:254` — queued assignments remain unstarted; `packages/app/tests/services/strategy-runtime.test.ts:527` — a rest switch holds subsequent tasks while running work retains its slot through reconciliation; `packages/app/tests/services/strategy-runtime.test.ts:598` — heartbeat prevents the running slot from expiring; `bun run spur-check` (exit 0). |
| R6 — Restart resumes persisted state before dispatching | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `packages/app/tests/services/strategy-runtime.test.ts:471` — unresolved deliveries gate dispatch; `packages/app/tests/services/strategy-runtime.test.ts:568` — unfinished task/run receipts survive restart and prevent repeat dispatch; `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0838

**Scope:** 0838 surface only — migration `0046_spur_cli_project_strategy` + `drizzle/0046_spur_cli_project_strategy.sql` (renumber 0045→0046 logged in `## Solution`), NEW `packages/domain/src/dao/project-strategy-dao.ts`, NEW `packages/app/src/services/strategy-runtime.ts`, `task-check.ts` `firstBlockingPrerequisite` addition, `apps/cli/src/commands/projects.ts` `--fleet` strategy surface, docs rows + NEW tests (`strategy-runtime.test.ts` 14, `project-strategy-dao.test.ts` 4, `task-check.test.ts` +5, `delivery-reconciler.test.ts` +2, `projects.test.ts` extended). Settled 0835–0837 surfaces excluded from judgment.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | `--fleet` text/JSON parity gap: the `strategy:` line renders only after the fleet-resolution `continue`s, so a project with a persisted strategy but a missing/unresolvable `fleet.json` shows `strategy` in `--json` yet no strategy line in text output (R1's display intent holds for resolvable fleets; JSON always carries it). One-line hoist of the strategy block above the `continue`s restores parity — wrap residual, non-blocking | `apps/cli/src/commands/projects.ts:218-225,263-270` |
| 2 | P4 (advisory) | correctness | Feature doc storage table stale on BOTH renumbers: names `0044_spur_cli_project_claims` (shipped `0045`; 0044 is coordination_runs receipt columns) and `0045_spur_cli_project_strategy` (shipped `0046`), and attributes 0043 to 0833's receipts (0043 is the inbox request-key; receipts are 0044). The task doc `## Solution` logs the renumber but this table was never regenerated — doc-only drift, could mislead a future task targeting ids by the feature doc | `docs/features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md:159-166` |
| 3 | P4 (advisory) | correctness | Frozen AC scenario titles swap R2/R3 ("R2 — GTD dispatches…", "R3 — Rest drains…") against the Requirements numbering (R2=rest, R3=gtd); scenario bodies and every test label use the correct mapping. Doc-only | `docs/tasks4/0838_persisted-rest-and-gtd-strategy-runtime-with-restart-resume.md` (Acceptance Criteria block) |
| 4 | P4 (advisory) | architecture | `row.strategy as StrategyName` is an unchecked cast on read: a hand-edited/foreign-vocabulary row would surface in `getStrategy`/`ResumeReport` unvalidated. `selectNext` already falls back (`?? STRATEGIES[DEFAULT_STRATEGY]`); the trust boundary is the typed `setStrategy`. Validate at 0839's consumption seam if belt-and-braces is ever wanted | `packages/app/src/services/strategy-runtime.ts:231,262,292` |
| 5 | P4 (advisory) | architecture | Capacity-vs-priority interaction frozen into the five-step: idle instances are consumed in candidate-iteration order (`idle.shift()`) BEFORE the priority sort, so with scarce instances the `no-idle-instance` holds land by `TaskService.list` order (readDir order), not lowest priority — decisions themselves ARE priority-ordered; disclosed in `## Solution` design notes and pinned by test comment. Revisit if 0839 wants priority-ordered capacity assignment | `packages/app/src/services/strategy-runtime.ts:126-131,167-175` |
| 6 | P4 (advisory) | efficiency | `selectNext` resolves the injected dep gate sequentially per candidate with no snapshot cache (O(candidates × deps) markdown parses per pass). Fine at corpus scale and current call frequency; note for 0839's event-loop cadence | `packages/app/src/services/strategy-runtime.ts:297-301`; `packages/app/src/services/task-check.ts:1429` |

No P1–P2 findings. Scrutiny checklist: (1) R6 strict order verified — persist-when-absent → `resolveOrchestrator`, non-`bound-online` returns `reconciled: false` with `unresolved: []` and NO dispatch, `DeliveryReconciler.reconcile()` runs only on bound-online, restart-idempotent (persisted row/version never rewritten, tested). (2) GTD five-step precedence exact (first-failure-wins, each skip one hold); P9-sentinel priority-then-WBS sort pinned; dep gate is `firstBlockingPrerequisite` reusing the SAME `checkDependencyReadiness` walk with an additive return — finding pushes unchanged, sole caller unaffected, declared `dependencies[]` edges only (`proseSeeded: false`). (3) `selectNext` excludes the live write-slot holder with an explicit expiry check and pins `ownerEpoch` from the live orchestrator claim, else 0 (fenced fail-safe — every live claim out-ranks). (4) dao `set` is ONE guarded upsert with RETURNING and `strategy_version = project_strategy.strategy_version + 1` on every set incl. same-name — the `ProjectClaimDao.claim` precedent, monotonic-fence tests pass. (5) rest drains: zero decisions, per-candidate `rest-after-drain`, held slot untouched (drain, not cancel). (6) flag-not-verb under existing `--fleet`; `strategyError` isolated per project; docs rows present in both doc files. (7) Heartbeat correctly NOT wired: zero production callers of `.heartbeat(`, `WriteSlotService`, or `StrategyRuntime` — `selectNext`/`resume` are the 0839 seams. (8) Carried advisory dispositions legitimate: (a) TOCTOU accept is sound — window bounded by the 30s TTL and fenced at the consuming ends (`validateResult` epoch; 0839 pre-launch re-fence), no dao rewrite warranted; (b) tie-break tests genuinely pin newest-evidence-wins in BOTH directions; (c) `changes()` probes retained as wrap-residual fail-safe — no churn for nothing.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `0046_spur_cli_project_strategy` registered + wired into `CLI_SCHEMA_SQL` (`packages/domain/src/migrations.ts:328-337,362,1443-1446`), byte-compatible drizzle mirror (`drizzle/0046_spur_cli_project_strategy.sql`); default `rest`, absent-row default and read-only `getStrategy` tested (`strategy-runtime.test.ts:297-317`); same-name version bumps monotonic (`:307-317`, `project-strategy-dao.test.ts:26-34`); CLI reads only, never writes (`projects.ts:162-170`) |
| R2 | MET | `restStrategy` zero decisions + one `rest-after-drain` hold PER candidate (`strategy-runtime.ts:84-90`, test `:157-167`); held write slot untouched (drain, not cancel) (`strategy-runtime.test.ts:376-390`) |
| R3 | MET | five-step precedence in frozen order, first failure wins (`strategy-runtime.ts:104-165`, exact-sequence test `:170-218`); P9-sentinel priority-then-WBS sort (`:167-175`, test `:220-271`); decisions carry `strategyVersion`+`ownerEpoch` and `requiresWrite = member.writeCapable` (`:144-156`, tests `:273-294,333-362`); dep gate injected from `TaskCheckService.firstBlockingPrerequisite` (`task-check.ts:1385-1400`) — same walk as the L4 rule, additive return only (`task-check.ts:1318-1374`), sole caller `:1247` unaffected |
| R4 | MET | closed `DispatchHoldReason` union (`strategy-runtime.ts:32-39`); no silent-skip path — every branch falls to a hold; all six reasons exercised incl. `unmet-dependency` detail and `executor-unavailable` member consumption (`strategy-runtime.test.ts:170-218,333-362`) |
| R5 | MET | `STRATEGIES` is a two-entry `Record<StrategyName, Strategy>` literal (`strategy-runtime.ts:179`); no loader, registry file, or dynamic `import()` anywhere in the diff |
| R6 | MET | `resume` strict order — persist default when absent → `resolveOrchestrator` → non-`bound-online` returns `reconciled: false`, no dispatch → reconcile only when bound-online (`strategy-runtime.ts:252-275`); bound-offline/missing/bound-online tests (`strategy-runtime.test.ts:392-462`); Board-open never writes (tested); restart-idempotent (persisted gtd row NOT rewritten) |

##### Verification Evidence (fresh, this review)

- Gate artifact `.spur/run/0838-test-gate.status` = `rc=0`; log tail: **8144 pass / 0 fail**, 33,035 expects, 452 files, 159.82s; post-check rules all passed.
- Migration identity cross-checked: `drizzle/` folder ships `0045_spur_cli_project_claims` + `0046_spur_cli_project_strategy`; `CLI_MIGRATIONS[46].id` pinned in `migrations.test.ts`; fresh/upgrade convergence (25 steps) asserted.
- Feature-doc drift (finding 2) confirmed against the shipped `drizzle/` filenames, not the doc table.
- Heartbeat/WriteSlot/StrategyRuntime production-caller sweep: zero matches in `packages/*/src`, `apps/cli/src` (exports and tests only).

**Next:** PASS clears the Phase 7 gate. Disposition — finding 1 is a wrap residual (text-parity hoist, one line); finding 2 is a doc-table regeneration at wrap; finding 3 wraps with the doc; findings 4–5 hand to 0839's dispatch-loop work; finding 6 notes 0839 cadence. No repair required in this task.

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity" (semantics approved 2026-09-11)
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3 per-case traces, §4 missing production seams
- Prototype: `apps/cli/tests/fixtures/g6/strategy-prototype.ts`, `apps/cli/tests/commands/g6-strategy-prototype.test.ts`
- Preserved gates: `config/workflows/task-pipeline.yaml` readiness/verification remain authoritative

### History

- 2026-09-12T18:14:24.341Z todo → wip (system)
- 2026-09-12T18:58:36.656Z wip → testing (system)
- 2026-09-12T18:58:37.247Z testing → done (system)

