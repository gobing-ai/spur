---
schema_version: 1
name: Declare the project fleet under agent.fleet and gate serve on enabled
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.218Z
updated_at: "2026-09-15T18:20:56.533Z"
feature_id: G65
priority: P1
tags:
  - g65
  - config
  - fleet
  - server

dependencies: ["0857"]
---

## 0858. Declare the project fleet under agent.fleet and gate serve on enabled

### Background

Covers G65 scenarios R1, R2 (global-layer `agent.fleet` and `.spur/fleet.json`), R3 and R8 (design §2-§4).

After task 0857, `.spur/fleet.json` (`FleetDeclarationSchema`, `packages/config/src/index.ts:537`) is the only fleet carrier: `FleetService.load` reads the file (`packages/app/src/services/fleet-service.ts:136-160`, path from `declarationPath` at `:416`), and `spur serve` materializes whenever the file exists (`apps/server/src/serve.ts:692-700`). There is no on/off switch, and no autostart after 0857. Read surfaces: `spur projects list --fleet` (`apps/cli/src/commands/projects.ts:114,234`), `GET /api/project/fleet` (`apps/server/src/modules/health/index.ts:77-124`), and Board hints naming `.spur/fleet.json` (`ProjectsShell.tsx:118`, `AgentsView.tsx:162`, plus the `roster.ts:92` comment).

Operator decision (2026-09-14, design approval): an enabled fleet starts every enabled member at serve start; no per-member autostart flag.

### Requirements

- **R1** — Add `AgentFleetSchema` as `agent.fleet`: `enabled` (boolean, default `false`), `strategy` (`rest` | `gtd`, default `rest`), `orchestrator` (optional member local id), `members` (default `[]`, `FleetMemberSchema` unchanged) with the role-or-executor superRefine moved from `FleetDeclarationSchema`. Put the strategy tuple `FLEET_STRATEGIES` in `@gobing-ai/spur-config` and derive `StrategyName` in `strategy-runtime.ts` from it. Delete `FleetDeclarationSchema` / `FleetDeclaration`.
- **R2** — Extend the 0857 loader guard: `agent.fleet` in the global layer fails naming the global file and the project config; an existing `<project>/.spur/fleet.json` fails naming the file and telling the operator to move `members`/`orchestrator` under `agent.fleet` and delete it.
- **R3** — `FleetService.load(projectPath)` returns that project's merged `agent.fleet` (`null` when absent) instead of reading a file; `declarationPath` goes. `resolve()` keeps `missing: ['no-declaration']` for an absent section and adds `'fleet-disabled'` to `missing` when `enabled` is `false` (members are still resolved).
- **R4** — Serve: replace the `fs.exists(.spur/fleet.json)` gate with `agent.fleet?.enabled === true` → `FleetService.materialize(projectRoot)` → `supervisor.startAutostart(result.upserted)`. Absent or disabled → neither; log the state once. Materialize or autostart failure fails the start, as today.
- **R5** — Read surfaces: `projects list --fleet` help and text name `agent.fleet`, printing `fleet: disabled (agent.fleet.enabled: false)` and `fleet: no declaration (agent.fleet)`; `GET /api/project/fleet` adds `enabled: boolean` (the web snapshot type follows); the Board hints in `ProjectsShell.tsx` and `AgentsView.tsx` name `agent.fleet in .spur/config.yaml`, and the `roster.ts` comment follows.
- **R6** — An invalid `agent.fleet` (unknown strategy, a member with neither role nor executor, a non-boolean `enabled`) fails the load listing every issue with its `agent.fleet.*` path.
- **R7** — `apps/cli/schemas/spur-config.schema.json` adds `agent.fleet`; `config/config.example.yaml` carries the demo roster as an `agent.fleet` block (and the `spur init` project template if it has a fleet example); fleet tests move from `fleet.json` fixtures to config fixtures; `docs/design/project-switcher.md` §3.1 and `configuration-contracts.md` describe `agent.fleet` in the same commit.

### Acceptance Criteria

Graduates G65 feature scenarios R1, R2, R3, R8 — the Gherkin
below carries their exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R1 — agent.fleet declares the project fleet in project config
      Given a project .spur/config.yaml with agent.fleet members, an orchestrator pointer, and no enabled or strategy key
      When the layered config loads
      Then agent.fleet resolves with enabled false and strategy rest
      And FleetService resolves the same member ids, executors, and orchestrator binding a fleet.json declaration produced

    @core
    Scenario: R2 — Retired fleet declarations fail loudly with their replacement
      Given a config that still carries agent.team, a global-layer agent.fleet, or a project with .spur/fleet.json
      When the config loads or spur serve starts
      Then the load fails with an error naming the offending key or file and the agent.fleet replacement
      And nothing is silently stripped, merged, or read from the retired source

    @core
    Scenario: R3 — Serve materializes only an enabled fleet
      Given a project whose agent.fleet declares members
      When spur serve starts with agent.fleet.enabled false and again with it true
      Then specs are materialized and autostarted only on the enabled start
      And projects list --fleet and /api/project/fleet report the disabled fleet by name

    @edge
    Scenario: R8 — Invalid agent.fleet values name every issue
      Given an agent.fleet with an unknown strategy, a member declaring neither role nor executor, or a non-boolean enabled
      When the config loads
      Then the error lists each issue with its agent.fleet path
```

- **AC1 — agent.fleet declares the fleet (R1, R3).** Given a `.spur/config.yaml` with `agent.fleet.members` and `orchestrator` but no `enabled` or `strategy`, when the config loads, then `enabled` is `false` and `strategy` is `rest`, and `FleetService.resolve` returns the same member ids, executors and orchestrator binding the equivalent former `fleet.json` fixture produced.
- **AC2 — Retired sources fail loudly (R2).** Given `agent.fleet` in `~/.config/spur/config.yaml`, or a project containing `.spur/fleet.json`, when the config loads, then the load fails naming the offending file and the `agent.fleet` replacement, and nothing is read from it.
- **AC3 — Only an enabled fleet runs (R4, R5).** Given a project whose `agent.fleet` declares members, when `spur serve` starts with `enabled: false`, then no spec is upserted, nothing is autostarted, and `projects list --fleet` and `/api/project/fleet` report the fleet disabled; when it starts with `enabled: true`, then the specs are upserted and every upserted id is passed to `startAutostart`.
- **AC4 — Invalid values name every issue (R6).** Given an `agent.fleet` with an unknown strategy, a member without role or executor, and a non-boolean `enabled`, when the config loads, then the error lists all three issues, each with its `agent.fleet` path.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:34.293Z

**Decisions**

- **Project layer only.** A fleet is one worktree's roster (ADR-116); a machine-wide default has no meaning, so global `agent.fleet` is an error, not a merge input.
- **`enabled` is the single fleet switch.** It gates materialization and autostart; `members[].enabled` stays the per-member switch that preserves derived id indexes.
- **Autostart set = `materialize().upserted`** (operator, 2026-09-14: all enabled members, no per-member flag). Materialize already skips disabled members, so no second resolution.
- **Disabled still resolves.** Read surfaces show the declared roster with `fleet-disabled`, so the Board can explain why nothing runs.
- **`FLEET_STRATEGIES` lives in `@gobing-ai/spur-config`.** Config cannot import app; the app derives `StrategyName` from the tuple.
- **Rejected:** a `fleet.json` fallback or dual-read (hides drift); a `spur` verb to toggle the fleet (edit config instead; no new public surface).

**Premises (verified 2026-09-14)**

- `packages/config/src/index.ts:537` `FleetDeclarationSchema`, `:564` `FleetDeclaration`.
- `packages/app/src/services/fleet-service.ts:136-160` `load` reads JSON and parses with `FleetDeclarationSchema`; `:317` `materialize`; `:324` no-declaration error; `:416` `declarationPath`.
- `apps/server/src/serve.ts:692` file-exists gate, `:695-700` `FleetService.materialize`, `:715` `startAutostart`.
- `apps/server/src/modules/health/index.ts:97` and `:177` construct `FleetService` for `/api/project/fleet`.
- `apps/cli/src/commands/projects.ts:114` `--fleet` help, `:234` no-declaration text.
- Board: `ProjectsShell.tsx:118`, `AgentsView.tsx:162` hints; `roster.ts:92` comment (no hint in `useProjectContext.tsx`).
- `packages/app/src/services/strategy-runtime.ts:20` `StrategyName = 'rest' | 'gtd'`.
- Tests: `packages/app/tests/services/fleet-service.test.ts`, `packages/config/tests/{config-schemas,loader}.test.ts`, `apps/server/tests/{serve,modules/health}.test.ts`, `apps/cli/tests/commands/projects.test.ts`, `apps/web/tests/modules/projects/{ProjectsShell,AgentsView}.test.tsx`.

**Dependencies:** 0857 (the loader guard and the removal of the `agent.team` autostart path).

### Design

Contract frozen in `docs/design/fleet-config-declaration.md` §2-§4.

- **Project layer only.** A fleet is a worktree's roster (ADR-116); a machine-wide default has no meaning, so the global layer is an error rather than a merge input.
- **`enabled` is one switch.** It gates both materialization and autostart; `members[].enabled` stays the per-member switch that preserves derived id indexes.
- **Autostart set = `materialize().upserted`.** Materialize already skips disabled members, so the upserted ids are exactly the members to start — no second resolution.
- **Disabled still resolves.** Read surfaces show the declared roster with `fleet-disabled` in `missing`, so the Board can explain why nothing runs.
- **`FLEET_STRATEGIES` in config.** `packages/config` cannot import `packages/app`; the app derives its type from the config tuple (one vocabulary).
- **Rejected:** keeping a `fleet.json` fallback (dual-read hides drift), a `spur` verb to toggle the fleet (out of scope — edit config).

### Plan

1. Config: `FLEET_STRATEGIES`, `AgentFleetSchema` under `agent`, delete `FleetDeclarationSchema`; schema tests for defaults and R6 issue paths.
2. Loader guard: global-layer `agent.fleet` and `.spur/fleet.json`; loader tests.
3. `FleetService.load`/`resolve` from merged config; move fleet-service tests to config fixtures and prove id/executor/orchestrator parity with the previous fixtures.
4. `serve.ts` enabled gate + `startAutostart(result.upserted)`; server tests for disabled vs enabled.
5. `projects list --fleet`, `/api/project/fleet` `enabled`, Board hints; CLI, server and web tests.
6. JSON schema, example/template config, project-switcher §3.1 and configuration-contracts.
7. `bun run spur-check`, `bun run test-cf`, `bun run build`.

### Solution

`agent.fleet` is now the project's only fleet declaration, and `spur serve` runs a fleet only when
it is explicitly enabled.

| Change | Anchor |
| --- | --- |
| `AgentFleetSchema` — `enabled` (default `false`), `strategy` (`FLEET_STRATEGIES`, default `rest`), `orchestrator`, `members`; the role-or-executor refinement moved off the retired declaration | `packages/config/src/index.ts:511` |
| Strategy vocabulary exported for the app to derive from, replacing the app-side duplicate | `packages/config/src/index.ts:465`, `packages/app/src/services/strategy-runtime.ts:25` |
| Global-layer `agent.fleet` refused, naming the global file and the project config | `packages/config/src/loader.ts:347` |
| A leftover `<project>/.spur/fleet.json` refused, naming the file and the move under `agent.fleet` | `packages/config/src/loader.ts:367` |
| Invalid `agent.fleet` reports every issue with its `agent.fleet.*` path (the refinement keeps Zod paths on the section) | `packages/config/src/index.ts:508` |
| `FleetService.load` resolves the merged config section instead of reading a file; `declarationPath` is gone | `packages/app/src/services/fleet-service.ts:153` |
| A disabled fleet is a named `missing` reason while members still resolve | `packages/app/src/services/fleet-service.ts:232` |
| Serve gates on `agent.fleet.enabled` — absent or disabled starts neither materialize nor autostart | `apps/server/src/serve.ts:700` |
| `GET /api/project/fleet` carries the fleet's `enabled` state | `apps/server/src/modules/health/index.ts:153` |
| `projects list --fleet` prints the disabled and no-declaration states by name | `apps/cli/src/commands/projects.ts:119` |
| Board hints name `agent.fleet` as the declaration surface | `apps/web/src/modules/projects/ProjectsShell.tsx:118`, `apps/web/src/modules/projects/AgentsView.tsx:162` |
| `agent.fleet` added to the hand-maintained `spur-config.schema.json` | `apps/cli/schemas/spur-config.schema.json:176-178` |
| Project-layer shape documented (commented — a live block here would contradict the global-layer refusal) | `config/config.example.yaml:190` |
| Design satellites describe the declaration in the same commit | `docs/design/project-switcher.md:64`, `docs/design/configuration-contracts.md:31` |

Fleet fixtures move from `.spur/fleet.json` files to config sections across the config, app, server,
CLI and web suites, and `plugins/sp/skills/spur-cli/references/projects.md` follows the read-surface
wording.

**Execution note.** The `implement` stage's dispatched child timed out twice at the 30-minute host
limit; per the timed-out-implement runbook the partial tree was the recovery input, and the host
session completed the remainder (formatting drift in three files and this section) before the gate
run. The gate result below is the stage's evidence, not the implementer's report.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Live probe (fresh): `.spur/config.yaml` with members+orchestrator and no enabled/strategy → `agent.fleet` resolves `enabled: false`, `strategy: rest`, 1 member, orchestrator `boss`. `packages/config/tests/config-schemas.test.ts` + `loader.test.ts` → 101 pass, 0 fail (fresh); `FLEET_STRATEGIES` in `@gobing-ai/spur-config`, `FleetDeclarationSchema` absent (rg → 0 live hits). |
| R2 | MET | Live probe (fresh): leftover `<project>/.spur/fleet.json` → load fails `The retired fleet declaration …/fleet.json still exists. Move its members and orchestrator under agent.fleet in the project config, then delete the file.`; global-layer `agent.fleet` guard tests → 3 pass, 0 fail (`bun test tests/loader.test.ts -t "agent.fleet"`, fresh). |
| R3 | MET | `packages/app/tests/services/fleet-service.test.ts` → 58 pass across it and strategy-runtime (fresh); `FleetService.load` reads merged config (no `declarationPath`); `resolve()` `missing` semantics covered by the suite. |
| R4 | MET | `apps/server/src/serve.ts:708` — gate is `fleetSection?.enabled === true` → `materialize` → `supervisor.startAutostart(materialized.upserted)`; absent/disabled logs the state once at `:721-724`; `apps/server/tests/serve.test.ts` → 52 pass, 0 fail (fresh). |
| R5 | MET | `apps/cli/src/commands/projects.ts:229,235` — prints `fleet: no declaration (agent.fleet)` / `fleet: disabled (agent.fleet.enabled: false)`; `GET /api/project/fleet` at `apps/server/src/modules/health/index.ts:82` carries `enabled` (`:86`); web wire shape follows at `apps/web/src/modules/projects/useProjectContext.tsx:41`. |
| R6 | MET | Live probe (fresh): `enabled: yes` + `strategy: sprint` + member with neither role nor executor → one error listing all three issues with paths `agent.fleet.enabled`, `agent.fleet.strategy`, `agent.fleet.members[0].role |
| R7 | MET | `apps/cli/schemas/spur-config.schema.json:176` declares `fleet` (no `team` key); `config/config.example.yaml` updated in commit `adde42d51` with the `agent.fleet` block; config fixtures fresh-green (101 pass). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — agent.fleet declares the project fleet in project config | MET | command | Fresh live probe through `loadSpurConfig`: defaults `enabled: false` / `strategy: rest` resolve; members and orchestrator bind. |
| Scenario: R2 — Retired fleet declarations fail loudly with their replacement | MET | command | Fresh probe: `.spur/fleet.json` fails naming the file + `agent.fleet` replacement; global-layer `agent.fleet` fails via guard tests (3 pass, fresh); nothing stripped or merged. |
| Scenario: R3 — Serve materializes only an enabled fleet | MET | test | `apps/server/tests/serve.test.ts` → 52 pass / 0 fail (fresh) covering the enabled/disabled gate; gate code at `apps/server/src/serve.ts:708`; disabled report text at `apps/cli/src/commands/projects.ts:235` and API `enabled` field at `apps/server/src/modules/health/index.ts:86`. |
| Scenario: R8 — Invalid agent.fleet values name every issue | MET | command | Fresh probe: single load error lists all three issues, each with its `agent.fleet.*` path. |
| AC1 — agent.fleet declares the fleet (R1, R3) | MET | command | R1-scenario probe + fleet-service suite 58 pass (fresh). |
| AC2 — Retired sources fail loudly (R2) | MET | command | R2-scenario probe + guard tests (fresh). |
| AC3 — Only an enabled fleet runs (R4, R5) | MET | test | serve.test.ts 52 pass (fresh) + gate/read-surface citations above. |
| AC4 — Invalid values name every issue (R6) | MET | command | R8-scenario probe (fresh). |
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

- 2026-09-15T14:47:19.765Z todo → wip (system)
- 2026-09-15T15:10:42.481Z wip → testing (system)
- 2026-09-15T15:10:54.541Z testing → done (system)

