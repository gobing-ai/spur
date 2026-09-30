---
schema_version: 1
id: "A9"
name: "Script placement contract: CLI-owned logic, thin plugin glue, and pipeline check diet"
status: active
priority: P2
tags: []
created_at: "2026-09-29T06:16:01.355Z"
updated_at: "2026-09-29T10:34:25.246Z"
---

# A9: Script placement contract: CLI-owned logic, thin plugin glue, and pipeline check diet

## Goal

Give every script in the repo exactly one owning surface by responsibility: Spur behaviour lives in the `spur` CLI (`apps/cli` over `packages/app`), `scripts/` holds only this-repo self-dev work, and `plugins/sp/{scripts,lib,hooks}` are thin glue over `spur` verbs and a shared plugin lib. Enforce the contract mechanically, migrate the existing scripts in small reversible waves, and cut non-critical validation ceremony from the spur-dev pipelines so runs spend their budget on implementation.

## Scope

**In scope**

- Ownership-based placement contract for `apps/cli/src/commands`, `scripts/` (+ `package.json`), `plugins/sp/scripts`, `plugins/sp/lib`, `plugins/sp/hooks`; supersedes the audience-based table in `docs/design/harness-surface-governance.md` §2 (ADR-051 R4 / ADR-065 amendment).
- AGENTS.md and governance/ADR text stating the rules and the consent gate for any new public `spur` surface.
- `spur rule` rules that fail new violations: plugin-script size cap, no domain logic duplicated from `packages/app`, repo-only gates outside `plugins/sp/scripts`, `packages/*` never importing from `plugins/`.
- Complete inventory + per-script disposition of all 30 `plugins/sp/scripts` entries, the hooks, `plugins/sp/lib`, and `scripts/commands`.
- Phased migration: repo-only gates → `scripts/commands`; task/feature/workflow/history domain logic → flags on existing verbs (operator consents per flag); plugin scripts reduced to glue; duplicated logic deleted.
- Same-commit sync of workflow YAMLs, `config/plugin-scripts.json`, `build:scripts`, `.mjs` twins, and `sp` skills/commands/agents that reference moved scripts.
- Pipeline check diet: explicit keep-strict list (corpus-write validation, batch-create schema, verify verdict, lint/typecheck/tests); drop or soften the rest.
- Overengineering removals discovered on the touched seams.

**Out of scope**

- New `spur` nouns (none planned; any proposal returns to the operator first).
- Rewriting `scripts/commands` build/release tooling that already fits the contract.
- Changes to superskill itself or to non-`sp` plugins.
- Behaviour changes to the CLI verbs beyond the consented flags.

## Acceptance Criteria

```gherkin
Feature: Script placement contract, CLI-owned logic, thin plugin glue, and pipeline check diet

  @core
  Scenario: R1 — Each script surface has one written owner and boundary
    # covers: I1, I2, I4, I5, I6, I7
    Given the five script surfaces: apps/cli commands, scripts/commands, plugins/sp/scripts, plugins/sp/lib and plugins/sp/hooks
    When an agent reads the placement contract in the harness-surface governance satellite
    Then each surface has one stated responsibility, allowed imports and a decision rule for where new logic goes
    And spur-domain logic is placed under its owning existing noun in apps/cli with services in packages/app

  @core
  Scenario: R2 — New public spur surface requires operator confirmation at planning time
    # covers: I3
    Given a plan that adds a spur noun, verb or public flag
    When the plan reaches its design stage
    Then the plan lists each proposed surface with its justification
    And no new surface ships without the operator's explicit written confirmation recorded in the plan
    And a new noun additionally records why no existing noun can own the action

  @core
  Scenario: R3 — Key project files state the placement contract
    # covers: I9
    Given AGENTS.md, the init templates and the governance satellite
    When an agent plans a new script
    Then the key files point to the single placement contract without restating it
    And an ADR records the decision and its tradeoffs

  @core
  Scenario: R4 — A spur rule flags scripts placed on the wrong surface
    # covers: I14
    Given the placement contract encoded as a spur rule
    When a plugin script or hook grows domain logic beyond the glue budget or a scripts/commands entry duplicates a CLI verb
    Then spur rule run reports the file with the violated boundary
    And existing violations are listed in a baseline that shrinks as refactor waves land

  @core
  Scenario: R5 — Complete inventory classifies every existing script
    # covers: I10
    Given every file under plugins/sp/scripts, plugins/sp/lib, plugins/sp/hooks and scripts/commands
    When the inventory is generated
    Then each file has a target surface, a move action and a wave number
    And no file is left unclassified

  @core
  Scenario: R6 — Refactor lands in independently revertible waves
    # covers: I8, I11
    Given the inventory and the phased plan
    When each wave is decomposed into tasks
    Then each wave moves logic into the CLI or packages/app and leaves the plugin entry as a thin wrapper or removes it
    And plugin-smoke and the standalone contract stay green after every wave

  @core
  Scenario: R7 — Duplicated and overengineered scripts are deleted
    # covers: I12, I16
    Given scripts that duplicate packages/app services or wrap a single CLI call
    When their wave lands
    Then the duplicate is removed in favour of the single owner
    And each deletion is noted with its replacement in the task evidence

  @core
  Scenario: R8 — sp skills, commands and workflows track every CLI move
    # covers: I13
    Given a wave that moves a script invocation to a spur verb
    When the wave lands
    Then every sp skill, slash command and workflow YAML that invoked the old script calls the new verb
    And a search for the old script path in plugins/sp and config/workflows returns no live references

  @core
  Scenario: R9 — Pipeline checks keep only core gates strict
    # covers: I15, I16
    Given the idea and task pipeline YAMLs
    When the check diet lands
    Then redundant prechecks, duplicate route-fact writers and repeated probes are removed or made tolerant
    And the core gates for corpus validity, tests and verify verdict stay strict
    And the per-run action count drops measurably against the current baseline
```


## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1000 | W0 placement contract enforcement: key-file pointers, glue-budget check and sp-script-placement rule | done |
| 1001 | W1 delete stage-registry-adapter and move repo-only gates to scripts/commands | done |
| 1002 | W2 spur task check --precheck replaces size and evidence precheck scripts | done |
| 1003 | W2 spur task verdict lints the answer and folds residual findings | done |
| 1004 | W2 feature check --inventory and idempotent feature sync replace feature scripts | done |
| 1005 | W3 workflow progress --profile and history report --anatomy absorb profile and anatomy scripts | done |
| 1006 | W3 fold quality-gate into command.gate and slim inline-run-setup through the lib bundle | done |
| 1007 | W4 pipeline check diet and final placement sweep | done |
| 1012 | persist-out forwards task-cited .spur/run evidence artifacts | done |
| 1013 | Exclude transient .tmp-* test-fixture dirs from require-corresponding-test | todo |
| 1014 | Batch finalize: detect diverged main before fast-forward merge attempt | todo |
| 1015 | One-writer guard: per-checkout session heartbeat for corpus-writing agents | cancelled |
| 1016 | Task pipeline throughput: two-tier quality gate and proof ergonomics | todo |
| 1017 | Batch execution model: per-task subagent isolation with parallel fan-out | cancelled |
| 1018 | Placement scan: detect dynamic DB imports in plugin scripts | todo |
| 1019 | residual-scan adopts shared spurCommand; sweep test stages imports robustly | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-29T10:34:25.246Z backlog → active (system)

