---
schema_version: 1
id: "H82"
name: "Unified --agent execution-surface selector"
status: backlog
priority: P2
tags: []
created_at: "2026-08-02T05:50:05.816Z"
updated_at: "2026-08-02T07:23:24.809Z"
---

# H82: Unified --agent execution-surface selector

## Goal
Collapse the `--agent` / `--inline` / `--subprocess` triple into a single `--agent` selector whose
value names both the execution surface and the executor, so one flag expresses one decision across
all 19 model-bearing `/sp:dev-*` commands.
## Scope
### In scope

- Replace the three-flag surface with `--agent <inline|auto|<agent>|<executor>>`, default `inline`,
  on all 19 declaring commands.
- Reserve `inline` and `auto` as executor names; reject a config executor claiming either.
- Retain `--inline` and `--subprocess` as deprecated aliases for one release, then remove.
- Delete the `dev-run` / `dev-runall` pipeline-wrapper carve-out and record the expressiveness
  tradeoff in the ADR.
- Reconcile the evidenced `--agent auto` contradiction between `cross-cutting.md` and the flag
  glossary as part of the collapse.
- Close the executor-name test gap: `--agent <executor-name>` resolution is currently unproven.
- Verify tier-based `auto` resolution end-to-end against `min_tier` + `fallback`.

### Out of scope

- Rewriting the tier algorithm or the escalation loop — both already exist (ADR-033, commit
  `04cab820`). Tuning the per-stage tier floors is allowed; redesigning the mechanism is not.
- The `## Argument Flags` table migration and hint cleanup — that is feature H81 / task 0412, which
  depends on this landing first.
- Changing objective escalation triggers. They stay machine-owned and continue to override `inline`.
- Non-`dev-*` commands and any new runtime, dependency, or schema.
## Acceptance Criteria
```gherkin
Feature: Unified --agent execution-surface selector

  @core
  Scenario: R1 — One flag expresses the execution-surface decision
    Given any of the 19 model-bearing dev commands
    When its public flag surface is inspected
    Then it declares --agent and declares neither --inline nor --subprocess as canonical syntax
    And --agent accepts inline, auto, a coding-agent name, or a configured executor name
    And omitting --agent is equivalent to --agent inline

  @core
  Scenario: R2 — Each value resolves to one surface and one executor
    Given an --agent value
    When the execution surface is resolved
    Then inline runs the backing skill in the current session using the current coding agent
    And auto dispatches a subprocess whose executor is tier-resolved from the stage min_tier and fallback chain
    And a coding-agent name or executor name dispatches a subprocess using that executor
    And no combination of flags can request two surfaces at once

  @core
  Scenario: R3 — Objective escalation still overrides the operator
    Given --agent inline and a named objective escalation trigger
    When the surface is resolved
    Then subprocess execution is selected
    And the applied trigger is named in the dispatch or result

  @core
  Scenario: R4 — Reserved values cannot be shadowed by configuration
    Given a .spur/config.yaml declaring an executor named inline or auto
    When the agent configuration is validated
    Then validation fails naming the reserved value and the offending executor

  @core
  Scenario: R5 — Removed spellings stay discoverable
    Given the removed --inline and --subprocess spellings
    When an operator looks either one up
    Then the flag glossary retains its anchor as a stub naming --agent as the replacement
    And neither spelling appears in any canonical argument hint or command body
    # Amended 2026-08-02: these were never CLI-parsed - they are prompt text, so there is no
    # parser in which to emit a runtime deprecation warning. Glossary redirect stubs are the
    # deprecation surface appropriate to a prompt contract; alias prose in 19 command files
    # would be an unenforceable, untestable warning.

  @core
  Scenario: R6 — The pipeline carve-out is dissolved into the general rule
    Given dev-run and dev-runall
    When --agent is supplied
    Then the value addresses the stages that do the model-bearing work, via vars.agent
    And the contract presents this as the general rule applied, not as an exception or carve-out
    And the ADR records why dissolving beats deleting: an orchestrator loop runs no prompts
    # Amended 2026-08-02: the original "remove the carve-out" wording was wrong. Deleting it would
    # make --agent on a batch command select an executor for a loop that executes no prompts.
    # Under "--agent names who does the model-bearing work" the pipeline case IS the general rule.

  @core
  Scenario: R7 — The documented auto contradiction is resolved
    Given cross-cutting.md and the flag glossary
    When each describes --agent auto
    Then both state the same surface behavior
    And exactly one of them is the authority the other references

  @core
  Scenario: R8 — Executor-name resolution is proven, not assumed
    Given a configured executor name passed to --agent
    When the resolution path runs under test
    Then the named executor profile is selected with its declared agent and model
    And an unknown executor name fails with a diagnostic naming the available executors
    # Amended 2026-08-02: dropped "and tier". Tier does not participate in explicit-selector
    # resolution - it governs `auto` selection and escalation fallback, which R9 owns. Asserting
    # it here would require plumbing tier into the resolve result solely for a test.

  @core
  Scenario: R9 — Tier-based auto resolution is verified end to end
    Given a stage declaring a min_tier and a fallback chain
    When --agent auto resolves for that stage
    Then the cheapest eligible executor at or above min_tier is selected
    And an objective failure escalates along the declared fallback chain
    And chain exhaustion reports every executor tried

  @core
  Scenario: R10 — Surface and gates stay green
    Given the completed collapse
    When the repository gate runs
    Then command validation, lint, tests, and build pass
    And the ADR, cross-cutting contract, flag glossary, and affected backing skills agree with the shipped commands
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0413 | Collapse --agent/--inline/--subprocess into a single --agent selector with inline as the default value | done |
| 0415 | Mechanical consistency gate for sp contract surfaces: cross-surface flag parity, replacing prose-literal test assertions | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
