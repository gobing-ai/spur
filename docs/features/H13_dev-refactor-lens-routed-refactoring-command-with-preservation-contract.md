---
schema_version: 1
id: "H13"
name: "dev-refactor: lens-routed refactoring command with preservation contract"
status: backlog
priority: P2
tags: []
created_at: "2026-09-17T17:44:15.553Z"
updated_at: "2026-09-17T17:52:10.519Z"
---

# H13: dev-refactor: lens-routed refactoring command with preservation contract

## Goal

Give the sp plugin one refactoring entry point, `/sp:dev-refactor`, that routes a path through the four taste-refactoring lenses (api, architect, tests, ui), reports every finding in one shared P1–P4 schema with a preservation class, and applies fixes only under a baseline → apply → check → revert loop where behavior-preserving fixes may run automatically and any feature cut or breaking change requires an explicit human answer — so a cheaper executor can improve code quality without losing features.

## Scope

**In scope**

- New thin command `plugins/sp/commands/dev-refactor.md` with argument surface `[<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]`, passing `validate-commands.ts` (a–e) and `validate-flag-contracts.ts` (C1/C2).
- New coordinator skill `plugins/sp/skills/code-refactoring/` owning focus auto-detection, the shared `refactor-finding` schema, the P1–P4 severity map, the preservation classification (`preserving` / `cutting` / `breaking`), the fix ladder with per-rung eligibility (`auto` / `confirm` / `suggest`), the apply loop with revert, the HITL matrix (objective vs taste gates), and run-scoped artifacts (`-refactor-findings.json`, `-refactor-report.md`).
- Additive refinement of the four taste skills: a ≤40-line `## Spur contract` section mapping native output to the shared schema and severity map, a preserved-behavior inventory requirement, standard `license` + `metadata` frontmatter, and a `## CLI mode` in the api lens protocol modes.
- Surface bookkeeping: flag-glossary declaring lists, `plugins/sp/references/roles.md` command→role mapping, `plugins/sp/README.md` index, `dev-operations.md` § refactor row, owning design satellite update, and a dry run on a real repository target as acceptance evidence.

**Out of scope**

- Rewriting the taste skills' principles, pass orders, or native output contracts.
- New lenses (`code`, `data`) — recorded as deferred candidates only.
- Changes to `sp:code-improvement`, `sp:code-simplification`, `/sp:dev-review`, or the `super-reviewer` agent.
- New `spur` CLI nouns/verbs; any subprocess executor beyond the existing `--agent` contract.
- Automatic creation of follow-up tasks from deferred findings.

## Acceptance Criteria

```gherkin
Feature: dev-refactor: lens-routed refactoring command with preservation contract

  Scenario: R1 — Shared refactor-finding schema and P1–P4 severity map
    Given plugins/sp/skills/code-refactoring/references/finding-schema.md
    When a finding is emitted by any lens
    Then it carries id, focus, severity P1|P2|P3|P4, rung, evidence file:line, preservation class preserving|cutting|breaking, fix_eligibility auto|confirm|suggest, and a verify command
    And the lens-native severities (ui/tests P0–P3, architect A0–A7, api compatibility class) map deterministically to P1–P4

  Scenario: R2 — Fix ladder with per-rung eligibility and apply loop
    Given plugins/sp/skills/code-refactoring/references/fix-ladder.md
    When --fix blockers-first or --fix all is requested
    Then the executor records a green baseline check before any edit, applies one finding at a time, re-runs the check, and reverts the finding on regression
    And blockers-first applies only P1/P2 findings whose fix_eligibility is auto
    And no test is deleted or weakened by an applied fix

  Scenario: R3 — Focus auto-detection classifies by path
    Given plugins/sp/skills/code-refactoring/references/focus-detection.md and --focus auto
    When --scope resolves to test files, apps/web or .astro/.tsx/.css files, packages/contracts or apps/cli/src/commands files, or other source
    Then the lens set is tests, ui, api, or architect respectively, multiple matches run each lens, and the chosen set is reported before any lens runs

  Scenario: R4 — Taste skills carry a Spur contract, metadata, and preserved-behavior inventory
    Given plugins/sp/skills/taste-refactoring-{api,architect,tests,ui}/SKILL.md
    When each file is read
    Then each has license + metadata frontmatter and a ## Spur contract section of at most 40 lines mapping native output to the shared schema
    And each contract requires a preserved-behavior inventory and a preservation class on every proposal
    And plugins/sp/skills/taste-refactoring-api/references/protocol-modes.md has a ## CLI mode section

  Scenario: R5 — Coordinator skill sp:code-refactoring dispatches lenses and writes artifacts
    Given plugins/sp/skills/code-refactoring/SKILL.md
    When it runs against a --scope path
    Then it dispatches the selected taste skills, merges findings into .spur/run/<run-id>-refactor-findings.json, and writes .spur/run/<run-id>-refactor-report.md with a P1–P4 table and a preservation summary

  Scenario: R6 — Cutting and breaking findings always pause for an operator answer
    Given a finding with preservation class cutting or breaking and --auto
    When the apply phase reaches it
    Then it is never applied without an explicit operator answer, and under headless --auto it is deferred into the report as SUGGEST
    And --auto skips only the objective gates (scope/focus confirmation and per-batch apply confirmation)

  Scenario: R7 — dev-refactor command passes the wrapper and flag validators
    Given plugins/sp/commands/dev-refactor.md with argument-hint [<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]
    When bun plugins/sp/scripts/validate-commands.ts and validate-flag-contracts.ts run
    Then both exit 0, the flag glossary lists dev-refactor under --auto, --focus, --fix, --scope, --check and --agent, and --fix defaults to none

  Scenario: R8 — Surface bookkeeping is complete
    Given plugins/sp/references/roles.md, plugins/sp/README.md, spur-dev/references/dev-operations.md, and the owning design satellite
    When the plugin structure and roles tests run
    Then dev-refactor is mapped to one role, listed in the README command table with the new skill in the skills tables, has a dev-operations refactor row, and the satellite documents the command contract

  Scenario: R9 — Dry run on a real target produces a report without edits
    Given /sp:dev-refactor --scope <repo path> --focus auto --fix none
    When the run completes
    Then git status shows no source changes, the findings JSON validates against the schema, and the report lists the lens set, findings by severity, and the preservation summary
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0883 | Create the sp:code-refactoring coordinator skill: finding schema, severity map, fix ladder, focus detection, and the analyze/gate/apply/report procedure | todo |
| 0884 | Refine the four taste-refactoring skills: Spur contract sections, standard metadata frontmatter, preserved-behavior inventory, and an api CLI protocol mode | todo |
| 0885 | Add the /sp:dev-refactor command and surface bookkeeping: flag glossary, roles mapping, README, dev-operations row, and validators green | todo |
| 0886 | Dry-run /sp:dev-refactor on a real repository target and harden the contract from the evidence | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
