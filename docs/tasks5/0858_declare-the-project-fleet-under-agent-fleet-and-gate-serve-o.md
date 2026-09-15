---
schema_version: 1
name: Declare the project fleet under agent.fleet and gate serve on enabled
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.218Z
updated_at: "2026-09-15T15:10:54.541Z"
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
| R1 | MET | `packages/config/src/index.ts:511` `AgentFleetSchema` (`enabled` default false at :512, `strategy: z.enum(FLEET_STRATEGIES).default('rest')` at :513, `members` default [] at :516) with the role-or-executor refinement moved onto the ENTRY at `:479` (so a sibling type error cannot hide it); `FLEET_STRATEGIES` at `:465`, `StrategyName = FleetStrategy` at `packages/app/src/services/strategy-runtime.ts:25`; `FleetDeclarationSchema`/`FleetDeclaration` absent from `packages/`, `apps/`, `config/`, `plugins/` (rg → only the design doc). Live: `bun -e` loading `packages/config/src/loader.ts` against a project declaring `agent.fleet.members` + `orchestrator` and neither `enabled` nor `strategy` returned `{"enabled":false,"strategy":"rest","orchestrator":"planner-1","members":[…]}`. Tests: `packages/config/tests/config-schemas.test.ts:175,188,198`; `packages/config/tests/loader.test.ts:1078`; `cd packages/config && bun test tests/loader.test.ts tests/config-schemas.test.ts` → 101 pass / 0 fail |
| R2 | MET | `packages/config/src/loader.ts:701,702` run `assertNoRetiredTeamKey` + `assertNoGlobalFleetSection` on the RAW layers **before** `mergeSpurConfigLayers` (:707) and before either schema pass; `assertNoLegacyFleetFile` (:266) runs before the layer short-circuit so a project with no config at all still fails; the `agent.fleet`-in-global error is `loader.ts:361`, the `fleet.json` error `loader.ts:378`. Live probes with `HOME` pinned to an isolated global layer: a global-layer `agent.fleet` → `agent.fleet is not supported in the global config (<global file>). Declare the project fleet under agent.fleet in <project>/.spur/config.yaml …`; a leftover `.spur/fleet.json` → `The retired fleet declaration <path> still exists. Move its members and orchestrator under agent.fleet in the project config, then delete the file.` Tests: `loader.test.ts:994,1035,1049`; `apps/server/tests/serve.test.ts:308` (invalid section rejects the start) |
| R3 | MET | `FleetService.load` now returns the merged config section: `packages/app/src/services/fleet-service.ts:153-156` (`config?.agent?.fleet ?? null`); `declarationPath` has zero references repo-wide (rg); `resolve()` keeps `missing: ['no-declaration']` (`:175`) and pushes `'fleet-disabled'` when the section is disabled (`:232`) while still resolving the roster. Live: `projects list --fleet` on a declared-but-disabled project printed `fleet: disabled (agent.fleet.enabled: false)` plus both member rows and `orchestrator: bound-offline p1-planner-1`. Tests: `packages/app/tests/services/fleet-service.test.ts:140,303,327`; `cd packages/app && bun test tests/services/fleet-service.test.ts tests/services/strategy-runtime.test.ts` → 55 pass / 0 fail |
| R4 | MET | `apps/server/src/serve.ts:698` loads the project config strictly, `:700` gates on `fleetSection?.enabled === true`, `:702-711` materialize → `startAutostart(materialized.upserted)`, and a failure stops the quota consumer and rethrows (fails the start); `:716-721` logs the state once with two distinct messages (no-declaration vs `enabled: false`). Live `spur serve` probe (declared, `enabled` absent → disabled; `HTTP GET /api/project/fleet` 200) returned `{"enabled":false,"members":["p1-planner-1","p1-coder-1"],"capacity":{…,"missing":["fleet-disabled"]}}` and created **no** `.spur/agents/` specs. Tests: `apps/server/tests/serve.test.ts:256` (captures `autostarted` → `['legacy-coder']`; invalid section rejects the start) and `:327` (disabled → nothing materialized or autostarted); `cd apps/server && bun test tests/serve.test.ts tests/modules/health.test.ts` → 72 pass / 0 fail. Residual: the log line itself was not observable in my temp project (the serve runtime logger's sink comes from the server bootstrap, not the project config) — verified by code anchor only |
| R5 | MET | Live `projects list --fleet` reproduced every named state: `fleet: no declaration (agent.fleet)`, `fleet: disabled (agent.fleet.enabled: false)`, `fleet: unavailable (<loader error>)`, and the enabled roster with the `[disabled]` flag; `projects list --help` prints `--fleet  Also resolve each project's agent.fleet declaration and orchestrator binding` (`apps/cli/src/commands/projects.ts:103`). `GET /api/project/fleet` carries `enabled: boolean` (`apps/server/src/modules/health/index.ts:153`) plus `capacity.missing` (`:159`); Board hints name the declaration surface (`apps/web/src/modules/projects/ProjectsShell.tsx:118` incl. `agent.fleet.enabled: false` at `:122`, `AgentsView.tsx:162`) and the `roster.ts:92` comment follows. Tests: `apps/cli/tests/commands/projects.test.ts` (16 pass), `apps/web/tests/modules/projects/` 18 files (169 pass) incl. `ProjectsShell.test.tsx:127`, `AgentsView.test.tsx:123`, `roster.test.ts:141`. Residual (named): the Board renders the *degraded* state as "no fleet declared" because `capacity.total === 0` is checked before `missing` (`ProjectsShell.tsx:113-118`) while the route reports `enabled:false` and keeps the loader error only in `capacity.missing` (`health/index.ts:127-135`); the CLI distinguishes it as `fleet: unavailable` |
| R6 | MET | Live: one load error naming all three issues with their `agent.fleet.*` paths — `agent.fleet.enabled: Invalid input: expected boolean, received string`, `agent.fleet.strategy: Invalid option: expected one of "rest" |
| R7 | MET | `apps/cli/schemas/spur-config.schema.json:176-177` adds the `fleet` object with its project-layer-only note; fleet fixtures resolve from config sections instead of `fleet.json` files across the config/app/server/CLI/web suites (`packages/config/tests/loader.test.ts:1035` keeps the retired file only as a negative guard case); `docs/design/project-switcher.md:64` (§3.1) and `docs/design/configuration-contracts.md:31` describe `agent.fleet`; `config/config.example.yaml:182-201` documents the block shape with the demo roster commented — matching what `git show HEAD:config/config.example.yaml` already did for the retired carrier (the roster was never a live block in this file), and required by R2 for the file `spur init` seeds as `~/.config/spur/config.yaml`; the `spur init` template carries no fleet example, so R7's parenthetical is vacuous |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — agent.fleet declares the project fleet in project config | MET | command | Task AC1 `**AC1 — agent.fleet declares the fleet (R1, R3).**` + AC2. `bun -e` probe over `packages/config/src/loader.ts` on a project with `agent.fleet.members` + `orchestrator` and no `enabled`/`strategy` → `enabled:false, strategy:"rest"`; `FleetService.resolve` keeps the id/executor/binding logic untouched by this change set (`git diff HEAD -- packages/app/src/services/fleet-service.ts` adds only `enabled` + the `fleet-disabled` entry), and the resolution of `<slug>-<localId>`, executor and orchestrator is re-confirmed live by `projects list --fleet` (`p1-planner-1`, `p1-coder-1`, `bound-offline p1-planner-1`); `packages/config/tests/loader.test.ts:1078`, `packages/app/tests/services/fleet-service.test.ts:140` |
| R2 — Retired fleet declarations fail loudly with their replacement | MET | command | Task AC2 `**AC2 — Retired sources fail loudly (R2).**`. Live loader probes: global-layer `agent.fleet` → error naming the global file and `<project>/.spur/config.yaml`; leftover `.spur/fleet.json` → error naming the file and the move-then-delete fix; both guards execute on the raw layers before merge/schema (`loader.ts:701-707`), so nothing is stripped, merged or read; `packages/config/tests/loader.test.ts:994,1035,1049` |
| R3 — Serve materializes only an enabled fleet | MET | command | Task AC3 `**AC3 — Only an enabled fleet runs (R4, R5).**`. Live `spur serve` with a declared, default-disabled fleet: server started, `GET /api/project/fleet` → `{"enabled":false,"members":[2 resolved],"missing":["fleet-disabled"]}`, and `.spur/agents/` was never created (no spec upserted); the same state is what `projects list --fleet` prints as `fleet: disabled (agent.fleet.enabled: false)`; `apps/server/tests/serve.test.ts:256` captures the enabled path's `startAutostart` argument (`['legacy-coder']`) and `:327` asserts the disabled path materializes/autostarts nothing |
| R8 — Invalid agent.fleet values name every issue | MET | command | Task AC4 `**AC4 — Invalid values name every issue (R6).**`. Live load failure listing `agent.fleet.enabled`, `agent.fleet.strategy` and `agent.fleet.members[0]` in one error, each with its declaration path; the same detail reaches `GET /api/project/fleet` as `capacity.missing[0]` with a 200 (`apps/server/tests/modules/health.test.ts:409`); `packages/config/tests/config-schemas.test.ts:203` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:8ca75dac460ff56688e48e1eb77ed3340ee51f7ad93d9f1248ab5b384daabf9d |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T14:47:19.765Z todo → wip (system)
- 2026-09-15T15:10:42.481Z wip → testing (system)
- 2026-09-15T15:10:54.541Z testing → done (system)

