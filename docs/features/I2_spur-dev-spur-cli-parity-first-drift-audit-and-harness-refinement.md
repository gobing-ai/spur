---
schema_version: 1
id: "I2"
name: "spur-dev/spur-cli parity-first drift audit and harness refinement"
status: backlog
priority: P2
tags: []
created_at: "2026-08-11T20:26:51.743Z"
updated_at: "2026-08-11T21:18:41.650Z"
---

# I2: spur-dev/spur-cli parity-first drift audit and harness refinement

## Goal
Make `sp:spur-dev`, `sp:spur-cli`, and their plugin integration surfaces demonstrably consistent
with the current monorepo Spur CLI and project contracts. Preserve the existing ownership split:
the facade owns CLI noun/verb/flag semantics, the spine owns multi-step lifecycle orchestration,
and the CLI remains the validator.

Deliver this in two bounded phases: extend the existing parity harness and fix only the drift it
exposes, then perform a focused content/discoverability review of indexes, links, and structured
catalogs. The result must reduce future drift without rewriting the skills or adding runtime surface.
## Scope
**In scope:**

- Bidirectional parity checks for facade noun/verb/flag inventories, CLI-routed spine rows, and the
  AGENTS.md noun table against the source-local monorepo CLI.
- Extension of existing plugin parity tests, with at most one shared capture helper and one new
  focused parity test where no existing test owns the assertion.
- Evidence-driven fixes for every drift the checks expose.
- A bounded review of README indexes, cross-links, and exact structured catalogs, plus documentation
  of source-local CLI provenance and published-npm skew.
- Dogfood-driven hardening of the `sp-dev-idea` planning handoff: feature section quality, design
  revision feedback, task ordering, feature roster refresh, and refine-before-execute routing.

**Out of scope:**

- Runtime CLI behavior, new public commands or flags, dependencies, schemas, persistence, or transport.
- Rewriting the spine/facade architecture or consolidating both skills into one source.
- Mechanical detection of semantic duplication in arbitrary prose.
- Validation against every published npm installation; monorepo parity remains the deterministic gate.
- Adding dependency fields to the public task-batch schema or changing CLI command/flag surfaces.
## Acceptance Criteria
```gherkin
Feature: spur-dev/spur-cli parity-first drift audit and harness refinement

  @core
  Scenario: R1 — Facade inventories match the live CLI surface
    Given the facade documents per-noun verbs and flags
    And the source-local monorepo CLI exposes human help plus machine output where supported
    When the parity harness compares the documented inventory with the captured CLI surface
    Then it reports documented verbs or flags absent from the CLI
    And it reports CLI verbs or flags missing from the facade

  @core
  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given the spine routes lifecycle steps through CLI verbs or explicit non-CLI execution surfaces
    When the parity harness checks each CLI-routed row
    Then it reports every referenced noun or verb absent from the source-local CLI

  @core
  Scenario: R3 — Exposed drift is fixed before the pass is green
    Given the parity checks expose stale inventories, routes, exclusions, noun tables, indexes, or links
    When maintainers apply evidence-driven corrections
    Then the focused parity suite is green with no outstanding findings

  @core
  Scenario: R4 — AGENTS.md noun inventory matches the CLI
    Given AGENTS.md documents the public Spur CLI nouns
    When the parity harness compares that table with the source-local CLI noun inventory
    Then nouns present in only one surface are reported as drift

  @core
  Scenario: R5 — README indexes match shipped plugin surfaces
    Given the plugin README indexes commands, skills, and subagents
    When the index is compared with the shipped plugin files
    Then every indexed entry exists and every shipped surface is indexed

  @core
  Scenario: R6 — Plugin cross-links resolve
    Given plugin surfaces link to files, headings, commands, and skills
    When the focused link check resolves those references
    Then no checked link points to a missing target

  @core
  Scenario: R7 — Structured catalogs have one owner
    Given exact noun, verb, flag, routing, and index catalogs can be compared mechanically
    When the content pass detects duplicated structured inventories
    Then one surface owns each catalog and other surfaces link to that owner
    And arbitrary prose similarity is left to bounded manual review

  @core
  Scenario: R8 — Facade and spine ownership remain distinct
    Given the facade owns CLI noun, verb, and flag semantics including status-transition verbs
    And the spine owns multi-step lifecycle orchestration
    When the parity tests inspect both surfaces
    Then they fail if the facade takes orchestration ownership or the spine takes verb-inventory ownership

  @core
  Scenario: R9 — Published npm skew is documented
    Given a published npm Spur binary can lag the monorepo CLI
    When maintainers read the parity harness contract
    Then it states that monorepo tests do not validate every installed npm version

  @core
  Scenario: R10 — Refinement changes no runtime surface
    Given the feature is limited to harness documentation and tests
    When the change set is reviewed
    Then it adds no runtime behavior, public CLI surface, dependency, schema, persistence, or transport

  @edge
  Scenario: R11 — Explicit facade exclusions do not create false drift
    Given a noun is explicitly marked as outside the facade reference with a reason
    When the parity harness compares documented coverage
    Then that noun is not reported as missing facade documentation

  @edge
  Scenario: R12 — Non-CLI spine routes do not create false drift
    Given a spine row targets a slash command or inline model-bearing step
    When CLI route parity is checked
    Then the row is excluded explicitly rather than treated as a missing CLI verb

  @edge
  Scenario: R13 — Surface capture proves source-local provenance
    Given a stale global Spur binary may be on PATH
    When the parity harness captures the CLI surface
    Then it invokes the monorepo CLI entry directly
    And its output records the resolved binary and package version

  @core
  Scenario: R14 — Idea handoff is safe to execute
    Given the idea workflow has created a feature and task batch
    When it reaches handoff
    Then Goal and Scope contain clean feature intent rather than decomposition output
    And task ordering is encoded rather than left only in prose
    And the feature task roster is refreshed
    And tasks that fail readiness checks are routed through ready-depth refinement before execution
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0512 | Extend spur-cli/spur-dev parity harness to capture the live CLI surface | todo |
| 0513 | Fix spur-cli/spur-dev drift exposed by the parity harness | todo |
| 0514 | Content pass: README index, cross-links, and structured-catalog ownership | todo |
| 0515 | Harden sp-dev-idea planning handoff from dogfood findings | todo |
<!-- END AUTO-GENERATED -->

## Notes
Design-gate feedback — 2026-08-11

Revise the design once before decomposition:

- Extend the existing parity tests first. Add at most one shared CLI-surface helper and one new
  focused parity test only where no existing test owns the assertion; do not pre-allocate seven
  test files.
- Define the ownership boundary precisely: `sp:spur-cli` owns CLI noun/verb/flag semantics,
  including task and feature status-transition verbs; `sp:spur-dev` owns multi-step lifecycle
  orchestration. Do not assert that the facade contains no "lifecycle steps".
- Limit mechanical duplication checks to exact catalogs and structured inventories. Do not claim
  that arbitrary prose guidance can be reliably detected as duplicate.
- Treat human `--help` parsing as a narrow adapter with fixtures and explicit exclusions. Do not
  imply every noun exposes a machine-readable surface inventory through `--json`.
- Keep the change parity-first and evidence-driven: run the smallest new check, fix only exposed
  drift, then perform a bounded manual content/discoverability review.
- Preserve the no-runtime/no-dependency/no-public-surface constraint and the source-local CLI
  provenance rule.
## History

- 2026-08-11T21:14:07.773Z moved L → I2 (system)
- 2026-08-11T21:18:40.874Z moved I2 → L (system)
- 2026-08-11T21:18:41.650Z moved L → I2 (system)
