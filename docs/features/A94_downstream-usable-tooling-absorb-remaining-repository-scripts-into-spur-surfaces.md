---
schema_version: 1
id: "A94"
name: "Downstream-usable tooling: absorb remaining repository scripts into spur surfaces"
status: active
priority: P2
tags: []
created_at: "2026-11-20T07:53:05.455Z"
updated_at: "2026-11-20T08:47:33.146Z"
---

# A94: Downstream-usable tooling: absorb remaining repository scripts into spur surfaces

## Goal

Make Spur's remaining repository tooling usable by downstream Spur projects. Every behavior under `scripts/` that a downstream project would reasonably use moves into an existing `spur` noun: logic in `packages/app`, a thin CLI transport, and configurable scope instead of hardcoded Spur paths. Shipped rules and skills stop sending downstream agents to repository-only commands. `scripts/` keeps only what is irreducibly specific to the Spur source repo, and each retained file states its reason.

## Scope

**In scope**
- A per-file downstream-use disposition for every file under `scripts/` (`spur-dev.ts`, `scripts/commands/**`, companions, fixtures), recorded in a regenerated ownership report with its repo-wide test.
- Generic `spur builder` behavior: project-agnostic `verify-pack` and `build-binaries`. `bundle-plugins`, `bundle-laya-worker`, `emit-board-types` and `emit-migration-sql` join builder as Spur-package verbs, so `build`, `build:bundle`, `build:binaries` and the server build route through the CLI. The only exception is a recorded irreducible cold-boot step.
- Generic repository checks as `spur rule` evaluators or verbs on existing nouns, each with configurable scope: stale linked-package dist (link-check), lockfile dependency drift, the transition-shim ledger, and certified coverage provenance.
- `spur workflow` absorption of pipeline A/B evaluation (`eval-pipeline`) and candidate promotion records (`workflow-promotion`), with configurable fixture and candidate sources.
- The fleet host-capability probe on an existing agent verb; the dev-all multi-process supervisor on an existing surface (e.g. A92 `builder.actions` / `spur self exec`).
- Removing shipped-surface references to repository-only scripts or aliases (rule presets, plugin skills and references, rule-file comments).
- An ADR-130 amendment, design satellites, help, the spur-cli parity reference, and an ADR-051 consent request naming every exact new verb, flag and evaluator type.
- The `scripts/spur-dev.ts` usage() omissions, and shrinking the dispatcher after each proven move.

**Out of scope**
- New nouns, including any `dev` noun; commands deeper than `spur <noun> <verb>`; a raw dispatcher pass-through.
- Moving the sp-plugin contract gates (validate-commands, validate-flag-contracts, surface-drift-inventory, skill-eval, plugin-install-smoke, script-contract-check) into Spur surfaces. They stay as repository fixtures with a Superskill-handoff note.
- The hermetic test-launcher environment policy in `run-tests.ts`, `test-suite-termination`, the fleet/a2a/delegate E2E and benchmark scenarios, and `fixtures/` (only the host-probe arm moves).
- The `scripts/install.sh` first-binary bootstrap.
- `.github/workflows` edits, publishing, deployments and cross-repo Superskill changes.

## Acceptance Criteria

```gherkin
Feature: Downstream-usable tooling absorbed from repository scripts

  @core
  Scenario: R1 — Every script has a downstream-use disposition
    # covers: I1, I12
    Given spur-dev.ts and every scripts/commands module, companion test and fixture in the current tree
    When the ownership inventory is regenerated from git and checked by its repo-wide test
    Then each file records one disposition of moved, forwarder or retained with destination, callers and wave
    And every retained file states a responsibility reason naming why no downstream project would use it
    And the test fails when a file is added, removed or left without a disposition

  @core
  Scenario: R2 — Public surfaces are consented before implementation
    # covers: I13, I14
    Given the proposed verbs, flags and rule evaluator types of this feature
    When the design records the consent request
    Then the request names each exact surface, its noun, grammar and the legacy route it replaces
    And no surface is deeper than spur noun verb and no new noun is introduced
    And implementation of a public surface waits for a recorded operator grant

  @core
  Scenario: R3 — Package builds route through the CLI
    # covers: I3, I9
    Given the root, CLI and server package build scripts
    When build, build:bundle, build:binaries and the server build run from a clean checkout
    Then each step invokes a spur builder verb instead of scripts/spur-dev.ts
    And any remaining cold-boot forwarder is a single documented step with a recorded bootstrap reason
    And the produced binaries, bundle trees and generated sources are byte-equivalent to the pre-migration route

  @core
  Scenario: R4 — Builder packaging verbs work for a downstream project
    # covers: I4
    Given a non-Spur Bun package fixture with its own entry point and package name
    When verify-pack inspects its packed tarball and build-binaries cross-compiles its entry
    Then both succeed without a Spur source checkout and write a checksum manifest for the requested targets
    And unsafe tarball members and a missing entry fail before any output is written

  @core
  Scenario: R5 — Spur package staging and generators are builder verbs
    # covers: I9
    Given the Spur checkout
    When the plugin staging, laya worker staging, board type and migration SQL steps run through builder verbs
    Then their outputs match the retired script routes and an unchanged source reports unchanged
    And the verbs refuse a non-Spur source root with an actionable error instead of guessing paths

  @core
  Scenario: R6 — Linked dist and lockfile drift checks are configurable
    # covers: I5
    Given a downstream fixture whose linked package serves a stale dist and whose lockfile pins a drifted version
    When the stale-link and dependency-drift checks run with that project's package scope
    Then each reports the offending package with a remedy and fails the preset that enables it
    And the Spur repository keeps its existing findings with the at-gobing-ai scope configured rather than hardcoded

  @core
  Scenario: R7 — Transition shim ledger is a downstream rule
    # covers: I2, I8
    Given a project with a shim manifest and source markers
    When the ledger check runs against an unregistered marker and against a listed entry whose marker is gone
    Then both directions fail naming the shim id and file
    And the manifest path is configurable and absence of a manifest is a pass

  @core
  Scenario: R8 — Coverage provenance is enforceable downstream
    # covers: I7
    Given certified, stale-tree, byte-mismatched and missing coverage artifacts
    When a preset enabling coverage certification evaluates per-file coverage
    Then only the certified artifact proceeds to per-file findings and each other case fails with a coverage-artifact diagnostic
    And producing a certification is available outside the repository test launcher while the launcher's hermetic environment stays repository policy
    And writing and verifying a certification are separate verbs, not one verb with a mode flag

  @core
  Scenario: R9 — Pipeline evaluation is a workflow verb
    # covers: I6
    Given two pipeline definitions and fixture task templates from a configurable source
    When the workflow evaluation verb runs them in an isolated worktree
    Then it emits one record per fixture task with verdict, gate outcomes, token cost and wall clock, and a per-field diff
    And a dry run creates no worktree or task and the source tree is untouched afterwards

  @core
  Scenario: R10 — Workflow promotion records are workflow verbs
    # covers: I6
    Given a candidate file with pending, overdue, promoted and retired entries
    When the promotion check, evaluate and resolve verbs run
    Then the check fails an overdue candidate or an unreferenced parallel definition, evaluate fills the verdict from run history, and a contradicting resolve is refused
    And the candidate file path is configurable for downstream workflow layers

  @core
  Scenario: R11 — Fleet host probe is an agent verb
    # covers: I10
    Given installed and missing coding agents
    When the host capability probe runs as its own agent verb (`spur agent doctor-hosts`)
    Then it writes the host capability report with one row per probed agent and its wake channel
    And the fleet, a2a and delegate end-to-end scenarios remain repository fixtures with recorded reasons

  @core
  Scenario: R12 — Dev supervisor runs configured processes downstream
    # covers: I9
    Given a project configuring two long-running development commands
    When the supervisor runs and one child exits or the operator interrupts
    Then all owned process groups are terminated within the bounded grace period and the exit code reflects the first failure
    And the Spur repository's server plus web development topology is expressed as configuration, not code

  @core
  Scenario: R13 — Shipped surfaces do not reference repository-only scripts
    # covers: I15, I8
    Given the bundled rule presets, plugin skills, references and rule comments
    When the shipped-surface scan runs
    Then no shipped file invokes scripts/commands, scripts/spur-dev.ts or a repository-only package alias
    And repository-only gates that remain are reached only from repository package scripts
    And the retained sp-plugin contract gates each carry a Superskill handoff note

  @core
  Scenario: R14 — Dispatcher shrinks to retained entries
    # covers: I11, I12
    Given the migrated commands
    When scripts/spur-dev.ts is listed and invoked without a command
    Then its registrations and usage list exactly the retained commands with none missing or stale
    And invoking a retired command fails naming its spur replacement

  @edge
  Scenario: R15 — Source, packed and standalone proofs precede route retirement
    # covers: I14
    Given a moved surface and its retired script route
    When the wave's end-to-end proof runs against the source CLI, the packed tarball and a standalone binary
    Then a repeatable receipt records provenance, commands and before/after observations
    And no .github/workflows file, publish or deployment is touched
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1409 | A94 wave 1: script disposition inventory and dispatcher hygiene | wip |
| 1413 | A94 wave 5: workflow eval and promotion verbs | todo |
| 1410 | A94 wave 2: source-CLI bootstrap and Spur-package builder verbs | todo |
| 1415 | A94 wave 7: shipped-surface scan, governance sync and final audit | todo |
| 1414 | A94 wave 6: agent doctor --hosts and parallel builder actions | todo |
| 1412 | A94 wave 4: rule check-shims and certify-coverage | todo |
| 1411 | A94 wave 3: generic build-binaries, verify-pack and check-deps | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-20T08:47:33.146Z backlog → active (system)

