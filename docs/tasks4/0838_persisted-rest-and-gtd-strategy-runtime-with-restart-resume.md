---
schema_version: 1
name: Persisted rest and GTD strategy runtime with restart resume
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.725Z
updated_at: "2026-09-12T05:22:25.591Z"
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
  Scenario: R2 — GTD dispatches only eligible authorized work
    Given strategy gtd and a mix of authorized, unauthorized, unready, and blocked tasks
    When the orchestrator selects next work
    Then only authorized, ready, dependency-satisfied tasks dispatch, ordered by priority then WBS
    And every skipped task records an actionable hold reason

  @core
  Scenario: R3 — Rest drains without starting new work
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity" (semantics approved 2026-09-11)
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3 per-case traces, §4 missing production seams
- Prototype: `apps/cli/tests/fixtures/g6/strategy-prototype.ts`, `apps/cli/tests/commands/g6-strategy-prototype.test.ts`
- Preserved gates: `config/workflows/task-pipeline.yaml` readiness/verification remain authoritative

### History
