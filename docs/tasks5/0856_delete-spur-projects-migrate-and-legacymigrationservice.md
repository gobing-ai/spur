---
schema_version: 1
name: Delete spur projects migrate and LegacyMigrationService
status: todo
template: feature-impl
created_at: 2026-09-15T05:26:45.214Z
updated_at: "2026-09-15T05:32:33.551Z"
feature_id: G65
priority: P1
tags:
  - g65
  - cleanup
  - cli

---

## 0856. Delete spur projects migrate and LegacyMigrationService

### Background

Covers G65 scenario R5 (design: `docs/design/fleet-config-declaration.md` §6).

`spur projects migrate` (`apps/cli/src/commands/projects.ts:423`) and `LegacyMigrationService` (`packages/app/src/services/legacy-migration.ts`, ~813 lines, plus its ~930-line test; exports at `packages/app/src/index.ts:295-309`) exist only to convert `agent.team` rosters into `.spur/fleet.json`. G65 removes both carriers, and no registered project carries a fleet, so there is no converter to keep. The service reads `agent.team`, which task 2 deletes, so this deletion runs first.

Removing a public verb needs a row in the surface-governance consent ledger; Robin gave consent at G65 idea-eval (2026-09-14).

### Requirements

- **R1** — Remove the `migrate` subcommand and its wiring from `apps/cli/src/commands/projects.ts`; `spur projects migrate` becomes an unknown command. No shim or alias.
- **R2** — Delete `packages/app/src/services/legacy-migration.ts`, its test file, and every export of it from `packages/app/src/index.ts`.
- **R3** — Remove the verb from help and references: `docs/help/`, `docs/help2/projects.md`, `plugins/sp/skills/spur-cli/references/projects.md`, `docs/design/cli-contracts.md`, `docs/04_DESIGN.md`; update the CLI inventories/parity tests that enumerate it (help-doc-parity, json-envelope-inventory, spur-cli-parity, surface-drift-inventory).
- **R4** — Append one dated row to `docs/design/harness-surface-governance.md` recording the removal and the 2026-09-14 consent (add rows only).
- **R5** — Historical records stay untouched: `docs/plans/**`, `docs/reports/**`, task/feature corpus, existing ADR text.

### Acceptance Criteria

- **AC1 — The verb and service are gone (R1, R2).** Given the CLI, when `spur projects --help` runs, then `migrate` is not listed and `spur projects migrate` exits non-zero as an unknown command; `legacy-migration.ts` and its test do not exist and `@gobing-ai/spur-app` exports no LegacyMigration symbol.
- **AC2 — No reference remains (R3, R4, R5).** Given the repo, when `rg -n "projects migrate|LegacyMigration|legacy-migration"` runs excluding `docs/plans`, `docs/reports`, `docs/tasks*`, `docs/features`, `docs/00_ADR.md` and the generated `apps/cli/{plugins,web,config}` trees, then the only hit is the new governance ledger row, and `bun run spur-check` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:33.300Z

**Decisions**

- **Tombstone for `spur projects migrate`?** No. Commander's unknown-command error is the contract; no registered project carries an `agent.team` roster to convert (operator consent at G65 idea-eval, 2026-09-14).
- **Consent receipt?** One dated row in `docs/design/harness-surface-governance.md` (rows only). ADR text is untouched here; task 0861 lands the ADR-116 amendment.
- **Order.** First in the chain: `LegacyMigrationService` reads `agent.team`, which 0857 deletes, so removing it first keeps every commit compiling.

**Premises (verified 2026-09-14)**

- `apps/cli/src/commands/projects.ts:423` registers `.command('migrate')`; `:446` constructs `LegacyMigrationService`; `:9` imports it.
- `packages/app/src/index.ts:295,308` export `LegacyMigrationServiceContext` / `LegacyMigrationService` from `services/legacy-migration.ts` (class at `:215`).
- Tests touching it: `packages/app/tests/services/legacy-migration.test.ts`, `apps/cli/tests/commands/projects.test.ts`.
- Out of scope and kept: `spur task migrate` (`task.ts:938`) and the top-level `migrate` command (`commands/migrate.ts`) — different verbs.

**Dependencies:** none.

### Design

Pure deletion. The verb has no caller other than an operator running a one-off conversion that no project needs, so plain removal (commander unknown-command error) is the contract — a tombstone would be unobservable surface. The governance row is the consent receipt the public-surface rule requires; ADR text is not amended here (task 6 owns the ADR-116 amendment).

### Plan

1. `rg -n "projects migrate|LegacyMigration|legacy-migration"` over apps, packages, plugins/sp, docs, config (skip generated `apps/cli/{plugins,web,config}` and historical docs) to fix the removal set.
2. Delete the subcommand, service, test and exports.
3. Update parity/inventory tests and help docs until `cd apps/cli && bun test` passes.
4. Update the plugin reference, cli-contracts and 04 rows; add the governance row.
5. `bun run spur-check`, then `bun run build`.

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
