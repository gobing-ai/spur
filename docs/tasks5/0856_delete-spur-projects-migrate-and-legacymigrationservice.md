---
schema_version: 1
name: Delete spur projects migrate and LegacyMigrationService
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.214Z
updated_at: "2026-09-15T18:17:46.317Z"
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
- **R3** — Remove the verb from help and references: `docs/help/cmd_projects.md` and `plugins/sp/skills/spur-cli/references/projects.md` (verb table row + detail entry); update the CLI inventories/parity tests that enumerate it (`apps/cli/tests/json-envelope-inventory.test.ts`, plus help-doc-parity / spur-cli-parity / surface-drift-inventory where they enumerate the verb). `docs/help2/projects.md`, `docs/design/cli-contracts.md` and `docs/04_DESIGN.md` carry no `projects migrate` mention today — their `migrate` hits are the kept `self migrate` / hidden-alias verbs; do not touch them.
- **R4** — Append one dated row to `docs/design/harness-surface-governance.md` recording the removal and the 2026-09-14 consent (add rows only).
- **R5** — Historical records stay untouched: `docs/plans/**`, `docs/reports/**`, task/feature corpus, existing ADR text.

### Acceptance Criteria

Graduates G65 feature scenario R5 — the Gherkin
below carries its exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R5 — The legacy team migration path is gone
      Given spur projects migrate and LegacyMigrationService existed only to convert agent.team
      When this feature completes
      Then spur projects migrate is not a registered verb
      And no source, test, help doc, or plugin reference to the conversion remains
```

- **AC1 — The verb and service are gone (R1, R2).** Given the CLI, when `spur projects --help` runs, then `migrate` is not listed and `spur projects migrate` exits non-zero as an unknown command; `legacy-migration.ts` and its test do not exist and `@gobing-ai/spur-app` exports no LegacyMigration symbol.
- **AC2 — No live reference remains (R3, R4, R5).** Given the repo, when `rg -n "projects migrate|LegacyMigration|legacy-migration"` runs excluding `docs/plans`, `docs/reports`, `docs/tasks*`, `docs/features`, `docs/00_ADR.md` and the generated `apps/cli/{plugins,web,config}` trees, then the only hits are the rows-only governance ledger `docs/design/harness-surface-governance.md` (the kept 2026-09-12 addition row plus the new removal row) and the feature design doc `docs/design/fleet-config-declaration.md` (plan of record — 0861 owns its authority sync), and `bun run spur-check` passes.

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

#### Q&A entry — 2026-09-15T06:09:53.040Z

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

#### Q&A entry — 2026-09-14 refineall ready-depth pass

**Decisions**

- **R3 reference list corrected on re-verification:** `docs/help2/projects.md`, `docs/design/cli-contracts.md`, `docs/04_DESIGN.md` have no `projects migrate` mention (their `migrate` hits are the kept `self migrate` / hidden-alias verbs); the live carriers are `docs/help/cmd_projects.md`, the plugin `projects.md` reference, and the parity/inventory tests.
- **AC2 residual set corrected:** the rows-only governance ledger keeps the 2026-09-12 addition row, and `docs/design/fleet-config-declaration.md` is the feature plan of record (0861 owns its sync) — both remain legitimate rg hits after implementation.

### Design

Pure deletion. The verb has no caller other than an operator running a one-off conversion that no project needs, so plain removal (commander unknown-command error) is the contract — a tombstone would be unobservable surface. The governance row is the consent receipt the public-surface rule requires; ADR text is not amended here (task 6 owns the ADR-116 amendment).

### Plan

1. `rg -n "projects migrate|LegacyMigration|legacy-migration"` over apps, packages, plugins/sp, docs, config (skip generated `apps/cli/{plugins,web,config}` and historical docs) to fix the removal set.
2. Delete the subcommand, service, test and exports.
3. Update parity/inventory tests and help docs until `cd apps/cli && bun test` passes.
4. Update the plugin reference and `docs/help/cmd_projects.md`; add the governance row.
5. `bun run spur-check`, then `bun run build`.

### Solution

Pure deletion (R1, R2). `spur projects migrate` and its three output helpers are gone from
`apps/cli/src/commands/projects.ts`; the flag it owned (`SHARED_OPTIONS.dryRunProjectsMigrate`) is gone
from the shared-option registry; and `packages/app/src/services/legacy-migration.ts`, its test file and
every re-export of it from `packages/app/src/index.ts` are deleted. `@gobing-ai/spur-app` therefore
exports no `LegacyMigration*` symbol, and `spur projects migrate` falls through to commander's
unknown-command error (exit 1) with no shim or alias. That file also carried
`assertConfigBlockRemovalSafe` / `ConfigBlockRemovalBlockedError` (0848's halt guard); their only
consumer was the same test file, so they went with it rather than surviving as dead exports.

Docs and references follow the verb out (R3, R4): the subcommand row and the `## spur projects migrate`
section in `docs/help/cmd_projects.md`, the verb-table row and the detail entry in
`plugins/sp/skills/spur-cli/references/projects.md`, and one dated row appended to the consent ledger —
the 2026-09-12 addition row above it is kept as history, not rewritten. The verb-census comment and
expected total in `apps/cli/tests/json-envelope-inventory.test.ts` drop 67 → 66. `docs/plans/**`,
`docs/reports/**`, the task/feature corpus and ADR text are untouched (R5); `spur task migrate` and the
hidden `spur self migrate` alias are different verbs and stay.

Change map — one anchor per row, first changed line per file; the two deleted files are named here in
prose because a citation into a removed file cannot resolve:

| Change |
| --- |
| `apps/cli/src/commands/projects.ts:3` |
| `apps/cli/src/commands/shared-options.ts:100` |
| `apps/cli/tests/commands/projects.test.ts:423` |
| `apps/cli/tests/json-envelope-inventory.test.ts:279` |
| `packages/app/src/index.ts:287` |
| `docs/help/cmd_projects.md:13` |
| `plugins/sp/skills/spur-cli/references/projects.md:24` |
| `docs/design/harness-surface-governance.md:119` |

Deleted: `packages/app/src/services/legacy-migration.ts`, `packages/app/tests/services/legacy-migration.test.ts`.

Evidence this pass — the full project gate `bun run spur-check` is the pipeline's `test` hop, not
implement (`sp-code-implementation` § "Implement scope: do not run the project quality gate"), so this
pass ran the affected-path probes its dependency-aware matrix requires:

- `apps/cli` affected tests (`project` command suite, json-envelope census, help-doc parity,
  spur-cli parity, shared-option parity) — 38 pass, 0 fail.
- plugin structure/contract suites (`cli-surface-parity`, `command-contract`, `skill-structure`,
  `surface-drift-inventory`) — 243 pass, 0 fail.
- `bun run --filter @gobing-ai/spur-app typecheck` and `bun run --filter @gobing-ai/spur typecheck` — exit 0.
- CLI probes: `spur projects --help` lists add/remove/list/start/stop only; `spur projects migrate`
  exits 1 with `error: unknown command 'migrate'`.

Scope note: the shared-option registry file is not backticked in this task's body, but its `--dry-run`
entry existed solely for this verb and the shared-option parity test fails on any registry entry no
command spreads — removing the verb without it leaves a red gate. Nothing else was touched. The
generated bundles under `apps/cli/plugins`, `apps/cli/web` and `apps/cli/config` still carry the old
reference text until `bun run build` regenerates them; they are excluded from this task's rg lens.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command: `bun apps/cli/src/index.ts projects --help` lists only add/remove/list/start/stop + help (fresh this run); `bun apps/cli/src/index.ts projects migrate` → exit 1, `error: unknown command 'migrate'` — no shim, no alias. |
| R2 | MET | `ls packages/app/src/services/legacy-migration.ts packages/app/tests/services/legacy-migration.test.ts` → No such file (both); barrel probe `Object.keys(await import('./packages/app/src/index.ts')).filter(/LegacyMigration |
| R3 | MET | rg lens over repo excluding historical docs and generated `apps/cli/{plugins,web,config}` → hits only `docs/design/fleet-config-declaration.md:129,137` (feature plan of record, 0861 owns sync) and `docs/design/harness-surface-governance.md:116,119` (allowed ledger rows). Tests: apps/cli projects+json-envelope+help-doc-parity+spur-cli-parity+shared-option-parity → 38 pass / 0 fail (fresh). |
| R4 | MET | `docs/design/harness-surface-governance.md:119` — dated 2026-09-15 removal row for `spur projects migrate` recording the 2026-09-14 G65 idea-eval consent; the 2026-09-12 grant row at `:116` kept as history. |
| R5 | MET | rg lens finds no hits under `docs/plans/**`, `docs/reports/**`, task/feature corpus or `docs/00_ADR.md` outside the allowed rows; historical records untouched. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — The legacy team migration path is gone | MET | command | `spur projects migrate` exits 1 as unknown command (fresh); service + test absent from tree; barrel exports no `LegacyMigration*` symbol (probe, fresh); rg lens shows no source/test/help/plugin reference outside the two allowed doc files. |
| AC1 — The verb and service are gone (R1, R2) | MET | test | `cd apps/cli && bun test tests/commands/projects.test.ts tests/json-envelope-inventory.test.ts tests/help-doc-parity.test.ts tests/spur-cli-parity.test.ts tests/shared-option-parity.test.ts` → 38 pass, 0 fail (fresh); plus CLI probes above. |
| AC2 — No live reference remains (R3, R4, R5) | MET | command | rg lens (fresh) → exactly the two allowed sets: governance ledger rows `:116`/`:119` and feature design doc `:129`/`:137`; no other hits. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T06:30:26.781Z todo → wip (system)
- 2026-09-15T07:06:08.106Z wip → testing (system)
- 2026-09-15T07:06:20.163Z testing → done (system)

