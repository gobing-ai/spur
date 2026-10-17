---
schema_version: 1
id: "A92"
name: "Stack-neutral SDLC actions: builder.actions, spur self exec, and script-structure consolidation"
status: verifying
priority: P2
tags: []
created_at: "2026-10-17T03:57:44.144Z"
updated_at: "2026-10-17T15:58:36.176Z"
---

# A92: Stack-neutral SDLC actions: builder.actions, spur self exec, and script-structure consolidation

## Goal

Make Spur stack-neutral at the SDLC boundary: Spur owns a small, intent-named action vocabulary (build, dev, lint, test, check, …), each project binds those actions to its own toolchain in `.spur/config.yaml` under `builder.actions`, and `spur self exec <action>` runs them. Spur's gates and workflows resolve commands through that map instead of hard-coding bun, so a python + make project runs the same harness. The same vocabulary becomes the naming contract for root `package.json` scripts and the target shape for consolidating `scripts/`, `plugins/sp/scripts/` and `plugins/sp/lib`, grounded in the common script layers shared by spur-new, superskill and knowledge-kit.

## Scope

**In scope**

- A design satellite naming the SDLC action vocabulary, the binding/default rules, and the common script layers observed across spur-new, superskill and knowledge-kit.
- `builder.actions` config schema in `packages/config` (string or composite-list values, built-in bun defaults when undeclared, `{files}`/`{paths}`-style placeholders for scoped checks).
- `spur self exec <action>` (operator-requested public verb) with `--list`, `--dry-run` and `--json`, exit code propagated.
- Engine and workflow consumers resolving through the action map: quality-gate light/full tiers, feature-verification command, task-pipeline gate vars, wrapup tripwire.
- Root `package.json` scripts reviewed and mapped one-to-one to actions (or recorded as justified repo-local tooling); duplicated chains (`spur-check-new`, `spur-check-new:full`, `check:full`) collapsed.
- `scripts/commands`, `plugins/sp/scripts/hooks` and `plugins/sp/lib` audited against ADR-130 with the action vocabulary as target; dead or misplaced files removed or moved.
- `spur init` seeds a `builder.actions` block for the detected stack.
- Plugin skill/command prose that hard-codes `bun run <gate>` points at `spur self exec <action>`.

**Out of scope**

- Migrating superskill and knowledge-kit repositories (follow-up per repo; this feature ships the contract they adopt).
- Rewriting ADR-130 placement rules or the hook runtime (ADR-129).
- Automatic runtime stack detection beyond `spur init` seeding.
- Replacing bun as Spur's own runtime, or making Spur's own build stack-neutral.
- New CLI nouns, or any public verb other than `spur self exec`.

## Acceptance Criteria

```gherkin
Feature: Stack-neutral SDLC actions and script-structure consolidation

  @core
  Scenario: R1 — The SDLC action vocabulary and common script layers are documented
    # covers: I2, I6, I8
    Given the package.json scripts and script folders of spur-new, superskill and knowledge-kit
    When the design satellite for SDLC actions is read
    Then it names each action with its intent, default bun binding and composition, and it lists the common script layers with the owning surface for each

  @core
  Scenario: R2 — Project config binds actions to stack-specific commands
    # covers: I3, I4
    Given a .spur/config.yaml whose builder.actions maps build to "make build" and check to a list of lint and test
    When the config is loaded
    Then the schema accepts string and list values, rejects a malformed action name, a composite step that names no resolvable action, or a cyclic composite, and undeclared reserved actions resolve to the bun preset defaults

  @core
  Scenario: R3 — spur self exec runs a configured action and propagates its exit code
    # covers: I3, I5
    Given a project whose builder.actions maps test to a command that exits 3
    When spur self exec test runs
    Then the command runs in the project root with output streamed and spur exits 3, and --dry-run prints the resolved command without running it

  @core
  Scenario: R4 — spur self exec lists actions with their source
    # covers: I5
    Given a project with two declared actions and the rest undeclared
    When spur self exec --list --json runs
    Then every reserved and declared action appears with its resolved command and a source of config, preset, default or unbound

  @core
  Scenario: R5 — Quality gate tiers resolve commands through the action map
    # covers: I3
    Given a python project whose builder.actions binds check, lint-changed and test-changed with file placeholders
    When the task pipeline runs the light and full quality gate tiers
    Then the gate runs the bound commands with the scoped files substituted and no bun, bunx or biome literal is executed

  @core
  Scenario: R6 — Workflows and feature verification call actions instead of bun scripts
    # covers: I3, I6
    Given the shipped task-pipeline, feature-verification and wrapup-pipeline workflows
    When their default gate and verification commands are inspected
    Then each default invokes spur self exec with an action name and an explicit vars override still takes precedence

  @core
  Scenario: R7 — Root package.json scripts map to the action vocabulary
    # covers: I6, I7
    Given the reviewed root package.json of spur-new
    When each script entry is compared with the action vocabulary
    Then every entry is an action binding, a composition of actions, or a listed repository tool, and duplicate chains such as spur-check-new are removed with no remaining caller

  @core
  Scenario: R8 — Script folders follow the placement contract with no dead entries
    # covers: I1, I7
    Given scripts/commands, plugins/sp/scripts/hooks and plugins/sp/lib after cleanup
    When the script placement rule and a reachability scan run
    Then every file has a registered caller or an owning test, misplaced files sit in their owning surface, and the placement rule reports zero findings

  @core
  Scenario: R9 — spur init seeds builder.actions for the detected stack
    # covers: I3, I4
    Given an empty project containing a Makefile and pyproject.toml
    When spur self init runs
    Then the generated .spur/config.yaml contains a builder.actions block bound to make targets, and a bun project receives the bun bindings

  @core
  Scenario: R10 — Plugin guidance invokes actions through spur self exec
    # covers: I3, I6
    Given the sp plugin commands and skills that instruct agents to run the project gate
    When their gate instructions are scanned
    Then they reference spur self exec with an action name instead of a hard-coded bun run script

  @edge
  Scenario: R11 — Existing bun projects keep working without config changes
    # covers: I3
    Given a project whose .spur/config.yaml has no builder.actions block
    When the task pipeline quality gate and spur self exec check run
    Then they execute the same bun commands as before this feature
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1222 | SDLC action config schema and shared resolver | done |
| 1223 | spur self exec verb with list, dry-run and exit-code propagation | done |
| 1224 | Route quality gate and shipped workflows through SDLC actions | done |
| 1225 | Seed builder actions in spur self init by detected stack | done |
| 1226 | Consolidate package.json scripts and script folders onto the action vocabulary | done |
| 1227 | Point sp plugin gate guidance at spur self exec | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-17T04:39:10.675Z backlog → active (system)
- 2026-10-17T15:58:36.176Z active → verifying (system)

