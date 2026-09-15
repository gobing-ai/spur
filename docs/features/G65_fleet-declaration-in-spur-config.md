---
schema_version: 1
id: "G65"
name: "Fleet declaration in spur config"
status: active
priority: P2
tags: []
created_at: "2026-09-15T05:09:07.437Z"
updated_at: "2026-09-15T07:06:14.503Z"
---

# G65: Fleet declaration in spur config

## Goal

Make the project's agent fleet one validated section of the layered project config —
`agent.fleet { enabled, strategy, orchestrator, members }` — so composition, the on/off switch and the
dispatch strategy have a single source of truth. This replaces `agent.team`, `.spur/fleet.json` and the
DB-only strategy default. The remaining `team` runtime vocabulary (`/api/team/*` routes, `team.*` events,
`TeamService`) is renamed or removed so no surface still describes the retired team model.

## Scope

### In scope

- Config schema: add `agent.fleet` (project layer only) with `enabled` (default `false`), `strategy`
  (`rest` | `gtd`, default `rest`), `orchestrator` and `members`; remove `agent.team` and its schema,
  loader merge rule and JSON-schema entries; hand-maintained `spur-config.schema.json` and config
  templates follow.
- Hard load errors: a leftover `agent.team` key, `agent.fleet` in the global layer, or an existing
  `<project>/.spur/fleet.json` each fail loudly and name the replacement. No silent dual-read.
- `FleetService` reads `agent.fleet` from the merged config; `spur serve` materializes and autostarts
  only when `agent.fleet.enabled` is `true`; `projects list --fleet` and `/api/project/fleet` report the
  disabled state by name.
- Strategy: `agent.fleet.strategy` is the SSOT and is reconciled into `project_strategy` at serve start
  (bump `strategy_version` and emit `strategy.changed` only on a change).
- Delete `spur projects migrate`, `LegacyMigrationService` (`legacy-migration.ts`) and their tests/docs.
- Rename `/api/team/*` to fleet routes with web callers in the same change; remove the dead
  `team.up` / `team.down` events; rename `team.member.*` events; split `TeamService` into its live
  responsibilities (messaging/assignment, spec materialization) under non-team names.
- Docs: dated ADR amendment of ADR-116, `03_ARCHITECTURE`, `04_DESIGN` plus the config/CLI/project
  switcher satellites, the `spur-team-mode-design.md` supersession banner, and the plugin
  `projects.md` / `agent.md` references.

### Out of scope

- The already-landed direct cleanups: `spur team` noun, `agent create|edit|delete`, hidden
  `agent loop`, the Board Work tab and the plugin skill sweep.
- A `spur` verb to toggle the fleet or switch strategy (edit config; no new public surface).
- Any Projects module redesign (the later open-design pass).
- Migrating existing declarations: no registered project has a fleet, so there is no converter.
- Hidden top-level aliases (`init/serve/status/migrate/maintain`), the `builder` noun and the
  `--json-envelope` deprecation window.

## Acceptance Criteria

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

  @core
  Scenario: R4 — Configured strategy reconciles into the strategy runtime
    Given a project_strategy row recording rest
    When spur serve starts with agent.fleet.strategy gtd
    Then the row records gtd with a bumped strategy_version and one strategy.changed event
    And a restart with the same strategy changes neither the version nor emits an event

  @core
  Scenario: R5 — The legacy team migration path is gone
    Given spur projects migrate and LegacyMigrationService existed only to convert agent.team
    When this feature completes
    Then spur projects migrate is not a registered verb
    And no source, test, help doc, or plugin reference to the conversion remains

  @core
  Scenario: R6 — Fleet runtime surfaces carry fleet names
    Given the /api/team routes, team.* events, and TeamService used by web, CLI, and supervisor
    When the rename lands
    Then every live route, event, and service is reachable under a fleet or owning-noun name with its callers moved in the same change
    And team.up and team.down are removed rather than renamed

  @core
  Scenario: R7 — Authority documents match the shipped fleet surface
    Given ADR-116, the architecture, design satellites, config templates, the JSON schema, and plugin references describe fleet.json and agent.team
    When this feature completes
    Then a dated ADR-116 amendment records agent.fleet without rewriting history
    And every owner document, template, and reference names agent.fleet as the only declaration

  @edge
  Scenario: R8 — Invalid agent.fleet values name every issue
    Given an agent.fleet with an unknown strategy, a member declaring neither role nor executor, or a non-boolean enabled
    When the config loads
    Then the error lists each issue with its agent.fleet path
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0856 | Delete spur projects migrate and LegacyMigrationService | testing |
| 0857 | Retire the agent.team roster runtime | todo |
| 0858 | Declare the project fleet under agent.fleet and gate serve on enabled | todo |
| 0859 | Reconcile agent.fleet.strategy into project_strategy at serve start | todo |
| 0860 | Rename the remaining team runtime vocabulary and split TeamService | todo |
| 0861 | Sync authority documents with the agent.fleet surface | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-15T07:06:14.503Z backlog → active (system)

