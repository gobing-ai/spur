---
schema_version: 1
name: Reconcile agent.fleet.strategy into project_strategy at serve start
status: todo
template: feature-impl
created_at: 2026-09-15T05:26:45.219Z
updated_at: "2026-09-15T05:33:07.776Z"
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
- **R5** — Same-commit docs: the strategy paragraph in `docs/design/project-switcher.md` and the `strategy.changed` producer row in `docs/inventory/system-events-producer-audit.md` / `observability-contracts.md`.

### Acceptance Criteria

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

### Design

Compare-then-set lives on `StrategyRuntime` (it owns the row and the event), not in `serve.ts`, so the no-op-on-restart rule is unit-testable without booting a server. Reconcile runs for a disabled fleet too: the strategy is declared config, and the Board's `/api/project/fleet` strategy line should match it whether or not members run. Failure fails the start (Deterministic over implicit) — a silently stale strategy would dispatch under the wrong policy.

### Plan

1. Add `reconcileStrategy` with tests over an in-memory DB (changed, unchanged, event count).
2. Call it from `serve.ts` when `agent.fleet` is present; add a server-level test for the call/no-call split.
3. Update the project-switcher strategy paragraph and the event producer inventory rows.
4. `bun run spur-check`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History
