---
schema_version: 1
name: Reconcile agent.fleet.strategy into project_strategy at serve start
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.219Z
updated_at: "2026-09-15T15:31:13.492Z"
feature_id: G65
priority: P2
tags:
  - g65
  - fleet
  - strategy
  - server

dependencies: ["0858"]
---

## 0859. Reconcile agent.fleet.strategy into project_strategy at serve start

### Background

Covers G65 scenario R4 (design §3 step 4).

The dispatch strategy is DB-only today: `StrategyRuntime.getStrategy(path)` returns the `project_strategy` row or `rest` v1, and `setStrategy(path, name)` bumps `strategy_version` and inserts a `strategy.changed` system event on every call (`packages/app/src/services/strategy-runtime.ts`). After task 3, `agent.fleet.strategy` is the declared source of truth and must reach the runtime without a spurious version bump on each restart.

### Requirements

- **R1** — Add `StrategyRuntime.reconcileStrategy(path, name)`: read `getStrategy(path)` and call `setStrategy(path, name)` only when the names differ; return whether it changed.
- **R2** — `spur serve` calls it after config load and fleet materialization whenever `agent.fleet` is present (enabled or not), with `agent.fleet.strategy`. A failure fails the start.
- **R3** — An absent `agent.fleet` section does not touch `project_strategy`.
- **R4** — Tests: a `rest` row plus `gtd` config → the row records `gtd`, `strategy_version` +1, exactly one `strategy.changed`; a second reconcile with `gtd` → no version change and no event; absent section → no call.
- **R5** — Same-commit docs: the strategy paragraph in `docs/design/project-switcher.md` (:188, :216-238) and the `strategy.changed` row in `docs/design/event-tracking.md` (:294 — note the serve-start reconcile as a producer path). `docs/inventory/system-events-producer-audit.md` and `observability-contracts.md` carry no `strategy.changed` row today — nothing to sync there (0861 owns any authority-level additions).

### Acceptance Criteria

Graduates G65 feature scenario R4 — the Gherkin
below carries its exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R4 — Configured strategy reconciles into the strategy runtime
      Given a project_strategy row recording rest
      When spur serve starts with agent.fleet.strategy gtd
      Then the row records gtd with a bumped strategy_version and one strategy.changed event
      And a restart with the same strategy changes neither the version nor emits an event
```

- **AC1 — A changed strategy reconciles once (R1, R2, R4).** Given a `project_strategy` row recording `rest`, when `spur serve` starts with `agent.fleet.strategy: gtd`, then the row records `gtd` with `strategy_version` incremented by one and exactly one `strategy.changed` event.
- **AC2 — Restarts are silent (R1, R4).** Given that reconciled row, when `spur serve` starts again with the same strategy, then `strategy_version` is unchanged and no `strategy.changed` event is emitted.
- **AC3 — No section, no write (R3).** Given a project without `agent.fleet`, when `spur serve` starts, then `project_strategy` is not written.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:34.778Z

**Decisions**

- **Compare on `StrategyRuntime`, not in `serve.ts`.** It owns the row and the event, so the no-bump-on-restart rule is unit-testable without booting a server.
- **`setStrategy`'s always-bump contract is unchanged.** Its docstring pins "increments on EVERY set" for 0837's `stale-strategy` fence; `reconcileStrategy` simply skips the call when the name already matches, so the fence still moves only on a real change.
- **Reconcile a disabled fleet too.** The strategy is declared config; `/api/project/fleet` should report it whether or not members run.
- **Failure fails the start.** A silently stale strategy would dispatch under the wrong policy.
- **No row + declared `rest`.** `getStrategy` already reports `rest` v1 for a missing row, so the compare matches and nothing is written; row creation stays with the R6 resume path.

**Premises (verified 2026-09-14)**

- `packages/app/src/services/strategy-runtime.ts:237` `getStrategy` returns `{ name, version }`, defaulting to `rest` v1 when no row exists.
- `:250` `setStrategy` persists through `ProjectStrategyDao.set`, increments the version on every call, and `:259` inserts a `strategy.changed` system event.
- Tests: `packages/app/tests/services/strategy-runtime.test.ts`, `apps/server/tests/serve.test.ts`.

**Dependencies:** 0858 (`agent.fleet.strategy` exists only after the schema lands).

#### Q&A entry — 2026-09-15T06:12:05.602Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:34.778Z

**Decisions**

- **Compare on `StrategyRuntime`, not in `serve.ts`.** It owns the row and the event, so the no-bump-on-restart rule is unit-testable without booting a server.
- **`setStrategy`'s always-bump contract is unchanged.** Its docstring pins "increments on EVERY set" for 0837's `stale-strategy` fence; `reconcileStrategy` simply skips the call when the name already matches, so the fence still moves only on a real change.
- **Reconcile a disabled fleet too.** The strategy is declared config; `/api/project/fleet` should report it whether or not members run.
- **Failure fails the start.** A silently stale strategy would dispatch under the wrong policy.
- **No row + declared `rest`.** `getStrategy` already reports `rest` v1 for a missing row, so the compare matches and nothing is written; row creation stays with the R6 resume path.

**Premises (verified 2026-09-14)**

- `packages/app/src/services/strategy-runtime.ts:237` `getStrategy` returns `{ name, version }`, defaulting to `rest` v1 when no row exists.
- `:250` `setStrategy` persists through `ProjectStrategyDao.set`, increments the version on every call, and `:259` inserts a `strategy.changed` system event.
- Tests: `packages/app/tests/services/strategy-runtime.test.ts`, `apps/server/tests/serve.test.ts`.

**Dependencies:** 0858 (`agent.fleet.strategy` exists only after the schema lands).

#### Q&A entry — 2026-09-14 refineall ready-depth pass

**Decisions**

- **R5 doc surface corrected on re-verification:** the only live `strategy.changed` doc row is `docs/design/event-tracking.md:294`; `system-events-producer-audit.md` and `observability-contracts.md` have no such row, so R5 now names event-tracking and leaves authority-level additions to 0861. All other premises (`strategy-runtime.ts:237/:250/:259`, test files, project-switcher strategy paragraphs) re-verified against the tree unchanged.

### Design

Compare-then-set lives on `StrategyRuntime` (it owns the row and the event), not in `serve.ts`, so the no-op-on-restart rule is unit-testable without booting a server. Reconcile runs for a disabled fleet too: the strategy is declared config, and the Board's `/api/project/fleet` strategy line should match it whether or not members run. Failure fails the start (Deterministic over implicit) — a silently stale strategy would dispatch under the wrong policy.

### Plan

1. Add `reconcileStrategy` with tests over an in-memory DB (changed, unchanged, event count).
2. Call it from `serve.ts` when `agent.fleet` is present; add a server-level test for the call/no-call split.
3. Update the project-switcher strategy paragraph and the event producer inventory rows.
4. `bun run spur-check`, `bun run build`.

### Solution

The declared `agent.fleet.strategy` now reaches the strategy runtime at serve start, without minting a version or a wake fact on an unchanged restart.

| Change | Anchor |
| --- | --- |
| `StrategyRuntime.reconcileStrategy(path, name)` — reads `getStrategy` first and calls `setStrategy` only on a real difference, returning whether the row changed | `packages/app/src/services/strategy-runtime.ts:281` |
| `spur serve` calls it after config load and fleet materialization, only when the `agent.fleet` section exists; a failure fails the start | `apps/server/src/serve.ts:733` |
| The `FleetService` the reconcile's runtime context carries is the same instance the materialize path uses — hoisted, not constructed twice | `apps/server/src/serve.ts:702` |
| Strategy paragraph: the serve-start reconcile, its read-before-write rule, and the no-section case | `docs/design/project-switcher.md:229` |
| `strategy.changed` producer paths named for the catalog row (explicit change + serve-start reconcile) | `docs/design/event-tracking.md:343` |

Behavior worth naming: `setStrategy` keeps its documented always-bump contract (0837's `stale-strategy`
fence), so the comparison lives in `reconcileStrategy` next to the row and the event rather than at the
caller. A project with no `agent.fleet` section is never written to, and a declared `rest` against an
absent row is silent too — `getStrategy` already reports `rest` v1 without persisting.

Tests: `packages/app/tests/services/strategy-runtime.test.ts` (0859 R1/R3 — write-once, silent second
reconcile, default-vs-absent-row writes nothing) and `apps/server/tests/serve.test.ts` (AC1 rest row →
`gtd` v2 with exactly one `strategy.changed`; AC2 restart is silent; AC3 an undeclared project has no
row). The two pre-existing fleet boot tests gained the `taskService` stub the new boot-time runtime
reads through.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `reconcileStrategy` at `packages/app/src/services/strategy-runtime.ts:281` reads `getStrategy` (`:242`) and calls `setStrategy` (`:255`) only on a name difference, returning `true`/`false`. Independent probe (`packages/app/.tmp/probe-0859.ts`, file-backed DB): differing name → `changed=true`, row `gtd`, `strategy_version` 2, exactly one new `strategy.changed`; repeat → `changed=false`, version still 2, event count unchanged. Unit suite `packages/app/tests/services/strategy-runtime.test.ts` → 24 pass / 0 fail, including the three new `0859 R1`/`R3` cases |
| R2 | MET | `apps/server/src/serve.ts:741` calls `reconcileStrategy(normalizeProjectPath(projectRoot), fleetSection.strategy)` after `loadSpurConfig` (`:700`) and the materialize/autostart block (`:709-715`), guarded by `fleetSection !== undefined` (`:733`). Executable: `apps/server/tests/serve.test.ts` → 52 pass / 0 fail, the `0859 R2/R3` case boots `startServer` with a config whose `agent.fleet` omits `enabled` (Zod default `false`) and asserts the reconcile still runs (`agent.fleet.strategy reconciled to gtd` log, row `gtd`/v2, one event). The failure clause is static-ref only: `apps/server/src/serve.ts:744-747` catches, stops the quota consumer and rethrows — no swallowing catch sits between it and `startServer`'s caller, so a reconcile failure fails the start rather than serving an undeclared strategy |
| R3 | MET | The `fleetSection !== undefined` guard (`apps/server/src/serve.ts:733`) means an undeclared project never reaches the runtime; the serve case asserts `ProjectStrategyDao.get(undeclared)` is `null` after boot. Runtime-level probe: `reconcileStrategy(bare, 'rest')` with no row returns `false`, leaves the row absent and emits nothing — the `getStrategy` default cannot manufacture a write |
| R4 | MET | `packages/app/tests/services/strategy-runtime.test.ts:432-469` — rest row + `gtd` → row `gtd`, version 2, one event; second reconcile → no bump, no event; absent row + default → no write. `apps/server/tests/serve.test.ts:393-...` — the three-boot serve case (declared → reconcile once, restart → silent, undeclared → untouched). Both suites re-run by the verifier in their workspaces: 24/24 and 52/52 pass |
| R5 | MET | Same commit: the serve-start paragraph at `docs/design/project-switcher.md:229-234` (read-first, silent restart, absent section untouched, failure fails the start); the `strategy.changed` producer note at `docs/design/event-tracking.md:343` next to its catalog row (`:292`). The task's "nothing to sync there" claim re-verified: `rg strategy.changed docs/inventory/system-events-producer-audit.md docs/design/observability-contracts.md` → 0 rows in both |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Configured strategy reconciles into the strategy runtime | MET | test | `apps/server/tests/serve.test.ts` "0859 R2/R3: the declared agent.fleet.strategy reconciles into project_strategy once, silently on restart" — boot 1: row `rest` v1 → `gtd` v2, exactly one `strategy.changed`; boot 2 (same declaration): version stays 2, still one event; `bun test tests/serve.test.ts` in `apps/server` → 52 pass / 0 fail. Independent probe reproduced both halves on a file-backed DB |
| **AC1 | MET | command | `bun packages/app/.tmp/probe-0859.ts` → `PASS AC1 reconcile of a differing strategy writes once — changed=true strategy=gtd version=2 newEvents=1`; same assertion in `packages/app/tests/services/strategy-runtime.test.ts` (first `0859 R1` case) and in the serve case above |
| **AC2 | MET | command | Probe → `PASS AC2 repeat reconcile is silent — changed=false version=2 events=1 (was 1)`; unit case "a second reconcile with the same strategy is silent: no version bump, no event"; serve case boot 2 asserts `strategy_version` 2 and one event after restart |
| **AC3 | MET | test | Serve case boot 3 with a registry project lacking `agent.fleet` → `strategies.get(undeclared)` is `null` (no row written); unit case "the default matches an absent row without writing one (0859 R3)"; probe check `R3 default against an absent row writes nothing — row=null events=unchanged` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:f3a2ab66de870a4ae2f3857def782bd9e4268316cb34aeb225ee20f0fe726430 |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T15:20:42.891Z todo → wip (system)
- 2026-09-15T15:31:12.185Z wip → testing (system)
- 2026-09-15T15:31:13.492Z testing → done (system)

