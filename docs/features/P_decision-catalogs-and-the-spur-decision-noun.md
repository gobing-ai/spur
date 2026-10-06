---
schema_version: 1
id: "P"
name: "Decision catalogs and the spur decision noun"
status: done
priority: P2
tags: []
created_at: "2026-10-06T17:50:56.789Z"
updated_at: "2026-10-06T21:47:43.604Z"
---

# P: Decision catalogs and the spur decision noun

## Goal

Make YAML decision catalogs (`@gobing-ai/ts-ai-decision`) the single source of truth for AI decisions and give operators a standalone `spur decision` noun to list, inspect, run and health-check them, with the default DecisionMaker per decision point chosen in the global spur config. Each decision has a closed answer vocabulary and a deterministic declared fallback. This stage exists to measure DecisionMaker reliability; adopting the catalogs in existing workflows is deferred to child feature P1 and will happen gradually once that reliability is established.

## Scope

**In scope**

- `spur decision list | show | run | status` CLI verbs (thin transport over an app service; `--json` everywhere).
- Decision catalog SSOT in `config/decisions/`, shipped through the existing `bundle-config` copy, with `$schema` injection for `decisions/*.yaml` and the catalog JSON schema shipped in `apps/cli/schemas/`. Catalog entries for the existing workflow decision points (`task-triage`, `failure-class`, `review-failure-class`) are included so their reliability can be measured with `spur decision run` before any workflow uses them.
- Three-layer resolution mirroring ADR-113: `project` (`.spur/decisions/`) → `registered` (optional `decisions.paths`, `bundled:` prefix) → `shared` (installed package `config/decisions/`, no config entry required); first layer wins per catalog file; duplicate decision ids across winning catalogs are reported, not silently shadowed.
- `decisions` config section in the Zod config schema and `spur-config.schema.json`: `paths`, a global default `maker`, and per-decision-point `makers.<id>` overrides; documented in the shipped `config/config.global.yaml`.
- Effective maker precedence: `run --maker` → `decisions.makers.<id>` → `decisions.maker` → catalog entry `maker` → catalog `defaults.maker`; `show` and `status` report the effective maker and which source selected it.
- Owner docs: new ADR, `docs/design/decision-catalog.md` satellite + `04` index, `sp:spur-cli` reference `decision.md`.

**Out of scope**

- Any change to existing workflows or the workflow `decide` action: all replacement of workflow decision points is centralized in child feature P1 and postponed until DecisionMaker reliability is established.
- Durable decision-outcome history store or analytics in `status`.
- Server/oRPC/Board surfaces for decisions.
- New maker drivers or changes to `@gobing-ai/ts-ai-decision` itself.
- Per-decision model selection in config (catalog `model` stays authoritative until a need appears).
- Migrating `workflow.hitlDecisionMaker` (operator-pause responder, ADR-123) onto catalogs.

## Acceptance Criteria

```gherkin
Feature: Decision catalogs and the spur decision noun

  @core
  Scenario: R1 — Decision list shows every resolvable decision with its layer and catalog
    # covers: I2, I6
    Given decision catalogs in the project, a registered folder and the shared package folder
    When the operator runs spur decision list --json
    Then each decision appears once with its id, type, description, layer and catalog path
    And a decision whose catalog file is shadowed by a higher layer is listed only from the winning layer

  @core
  Scenario: R2 — Decision show describes one decision without calling a model
    # covers: I4
    Given a loaded catalog containing the decision task-triage
    When the operator runs spur decision show task-triage --json
    Then the output lists its parameters including instructions, criteria, fallback, effective minConfidence, maker, model and source path
    And no maker or driver is constructed

  @core
  Scenario: R3 — Decision run always returns a concrete answer from the closed vocabulary
    # covers: I3, I9
    Given a decision with declared criteria and a fallback
    When the operator runs spur decision run with valid parameters and the backend is unavailable, times out, errors or answers below the confidence floor
    Then the command exits 0 and prints the fallback value with source default and the matching reason
    And when the backend answers confidently the value is one of the declared criteria with source model

  @core
  Scenario: R4 — Decision run rejects caller mistakes before any backend call
    # covers: I3
    Given the decision catalogs are loaded
    When the operator runs spur decision run with an unknown id, a parameter that breaks the declared contract, or an unregistered maker name
    Then the command exits non-zero with an actionable error naming the decision and the offending field
    And no backend call is made

  @core
  Scenario: R5 — Decision status reports readiness and catalog problems per layer
    # covers: I5
    Given one valid catalog and one catalog with a fallback outside its answer vocabulary
    When the operator runs spur decision status --json
    Then it reports the configured default maker, each decision's effective maker with its source, the registered maker names and each layer path with its load result
    And the invalid catalog is reported with its file, decision id and field while valid catalogs stay usable
    And duplicate decision ids across winning catalogs are reported instead of silently shadowed

  @core
  Scenario: R6 — Repository decision catalogs live in config/decisions and ship in the package
    # covers: I6, I7
    Given decision catalog files under config/decisions in this repository
    When the CLI package is bundled for publishing
    Then the tarball contains config/decisions next to config/workflows
    And each bundled catalog carries a schema reference that resolves to a catalog schema shipped in the package

  @core
  Scenario: R7 — Installed CLI resolves shared decisions without a configured path
    # covers: I8
    Given the CLI installed from the package in a project with no .spur/decisions folder and no decisions section in either config file
    When the operator runs spur decision list
    Then the shared decisions from the installed package config/decisions are listed
    And adding a folder to decisions.paths in the global config adds it as a registered layer ahead of the shared layer

  @core
  Scenario: R8 — Global config selects the default DecisionMaker for each decision point
    # covers: operator feedback (maker selection)
    Given the global config sets decisions.maker to typesafe and decisions.makers.task-triage to laya-local
    When the operator runs spur decision show for task-triage and for failure-class
    Then task-triage reports effective maker laya-local selected by the per-decision config entry
    And failure-class reports effective maker typesafe selected by the global default
    And with neither key set the catalog maker applies, and run --maker overrides every other source
    And a configured maker name that is not registered is reported by status and makes run exit non-zero before any backend call

  @core
  Scenario: R9 — Design record captures the review of the original proposal
    # covers: I10, I8, I9
    Given the decision catalog design satellite and its ADR entry
    When a maintainer reads them
    Then they record each point where the shipped design differs from the original proposal with its reason
    And they state that the guarantee is a closed answer vocabulary with a deterministic fallback rather than deterministic model output
    And they state that workflow adoption is staged into child feature P1 behind DecisionMaker reliability evidence

  @edge
  Scenario: R10 — Shipped workflows keep their current decide actions in this stage
    # covers: operator feedback (staging)
    Given feature P is complete
    When the shipped workflow definitions under config/workflows are compared with their state before feature P
    Then every existing decide action and its result file are unchanged
    And spur decision run on a catalog decision never writes a workflow result file
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1092 | Decision catalog resolver, DecisionService and bundled config/decisions | done |
| 1093 | spur decision noun: list, show, run, status | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-06T19:30:17.882Z backlog → active (system)
- 2026-10-06T21:45:14.036Z active → verifying (system)
- 2026-10-06T21:47:43.604Z verifying → done (system)

