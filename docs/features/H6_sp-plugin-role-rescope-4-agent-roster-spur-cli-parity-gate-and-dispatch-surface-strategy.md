---
schema_version: 1
id: "H6"
name: "sp plugin role rescope: 4-agent roster, spur-cli parity gate, and dispatch-surface strategy"
status: done
priority: P2
tags: []
created_at: "2026-07-30T21:46:41.324Z"
updated_at: "2026-07-31T04:03:45.663Z"
---

# H6: sp plugin role rescope: 4-agent roster, spur-cli parity gate, and dispatch-surface strategy

## Goal

Rescope the `plugins/sp` subagent roster into four non-overlapping charters, close the
`spur-cli` skill's CLI-parity drift behind an automated gate, rename the TDD skill off the `spur`
namespace, and replace the contradictory subagent-vs-`spur agent run` guidance with a trigger-keyed
decision rule.

The unifying problem is **role drift between the plugin's prompt surface and its actual behavior**.
`super-coder` is named for coding but its file is 100% orchestrator; `spur-cli` documents a CLI
surface that has since grown three verbs and sixteen flags; `spur-tdd` carries a product prefix on
generic discipline; and `parallel-execution` tells Claude Code to fan out through the one surface
that cannot run in a sandboxed session. Each is the same failure: guidance that was true once and
silently stopped being true, with nothing to catch it.

## Scope

- In:
  - Rewrite of the four `plugins/sp/agents/*.md` charters — `expert-spur` (CLI/corpus SSOT,
      unchanged scope), `super-planner` (**new file**; body inherited from today's `super-coder`:
      product mgmt + project mgmt + execution orchestration), `super-coder` (**new body**:
      architecture/system design, production + test codegen, debug/fix), `super-reviewer`
      (review + remediation suggestions, unchanged scope).
  - Sweep of the 26 files that describe `super-coder` as the batch driver, incl.
      `plugins/sp/skills/spur-dev/references/execution-batch.md`, `plugins/README.md`,
      `plugins/sp/README.md`, `plugins/sp/skills/parallel-execution/SKILL.md`, `AGENTS.md`,
      `config/templates/AGENTS.md`, `plugins/sp/tests/skill-structure.test.ts`,
      `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, `docs/features/H1_*.md`, `docs/features/H4_*.md`.
  - Extraction of the shared F1/F2/F4/F5 "Definition of Done Housekeeping" block out of
      `super-coder.md` into a reference all four agents cite by path, not by cross-file anchor.
  - Repair of `plugins/sp/agents/super-reviewer.md:22` — drops the non-existent
      `sp:anti-hallucination` and `sp:tasks` skill declarations.
  - `spur-cli` reference refresh covering the 3 undocumented verbs (`task verifyall-aggregate`,
      `task scaffold-tests`, `feature sync`) and the uncited flags (task 21/28, feature 13/15,
      workflow 14/23), **plus** promotion of `agent` (8 verbs / 19 flags), `message` (5 verbs),
      `team` (7 verbs), `status`, `init`, and `serve` out of last-resort `--help` status.
  - A parity test under `plugins/sp/tests/` that parses verbs and flags from
      `apps/cli/src/commands/*.ts` and fails when a covered noun's reference omits one.
  - An ADR entry binding CLI surface changes to a same-change `spur-cli` update, and recording
      the dispatch-surface rule as a composition over ADR-033 (which owns model tier).
  - Rename `plugins/sp/skills/spur-tdd` to `plugins/sp/skills/test-driven-development`, updating
      the ~11 live referencing files.
  - New reference `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` holding
      the native-subagent-vs-`spur agent run` decision rule, cited by all four agents.

- Out:
  - Extracting orchestration into a fifth `super-runner` agent. Deferred by decision; the
      algorithm SSOT stays `execution-batch.md`, so a later extraction is a file move.
  - `spur-cli` coverage for `history`, `migrate`, `projects`, and `help` — deliberately excluded
      while those nouns remain immature; the parity test carries an explicit ignore-list.
  - Rewriting `docs/tasks2/*` historical task records that mention `spur-tdd` or `super-coder`.
      Those are immutable completion history.
  - Any change to the `spur` CLI itself, the stage registry, or ADR-033's model-tier routing.
  - Fixing the upstream `omp` SQLITE_READONLY sandbox failure — an external pi-coding-agent
      storage-path issue, documented here as motivating evidence only.

## Acceptance Criteria

```gherkin
Feature: sp plugin role rescope: 4-agent roster, spur-cli parity gate, and dispatch-surface strategy

  Scenario: The four agent charters are non-overlapping and correctly named
    Given the plugin ships expert-spur, super-planner, super-coder, and super-reviewer
    When an operator reads each agent's Role section
    Then super-planner owns product management, project management, and execution orchestration
    And super-coder owns architecture, system design, production and test codegen, and debugging
    And super-reviewer owns review and remediation suggestions but never implements a fix
    And expert-spur owns the spur CLI and corpus surface
    And no two agents claim the same responsibility

  Scenario: The orchestration algorithm is executed, not inlined
    Given super-planner has absorbed the batch-driver role
    When super-planner drives a batch
    Then it executes the loop defined in spur-dev/references/execution-batch.md
    And execution-batch.md remains the single source of truth for that algorithm
    And the workflow trace polling loop lives in the command or script layer, not in the agent body

  Scenario: Every reference to the retired super-coder role is updated
    Given 26 files described super-coder as the batch pipeline driver
    When the rescope lands
    Then each of those files names super-planner for orchestration duties
    And each names super-coder only for architecture, codegen, or debugging duties
    And no live file under plugins/ or docs/0*.md attributes batch driving to super-coder
    And historical records under docs/tasks2/ are left unmodified

  Scenario: Agent skill declarations all resolve
    Given each agent declares a skills list in its frontmatter
    When every declared sp: skill is resolved against plugins/sp/skills/
    Then every declared skill exists
    And super-reviewer no longer declares sp:anti-hallucination or sp:tasks

  Scenario: Shared done-time housekeeping has one home
    Given F1, F2, F4, and F5 housekeeping applied to more than one agent
    When the block is extracted to a shared reference
    Then all four agents cite it by file path
    And no agent cross-links another agent file by section anchor

  Scenario: spur-cli documents every verb of every covered noun
    Given the covered nouns are task, feature, rule, workflow, agent, message, team, status, init, and serve
    When each noun's verbs are parsed from apps/cli/src/commands
    Then each verb appears in that noun's spur-cli reference
    And task verifyall-aggregate, task scaffold-tests, and feature sync are documented

  Scenario: spur-cli documents every flag of every covered noun
    Given task cited 21 of 28 flags, feature 13 of 15, and workflow 14 of 23 before this change
    When each noun's flags are parsed from apps/cli/src/commands
    Then each flag is cited on a spur command line in that noun's reference

  Scenario: A CLI change without a skill update fails the build
    Given the parity test is in place
    When a new verb or flag is added to a covered noun without updating its spur-cli reference
    Then bun run test fails and names the missing verb or flag and its noun

  Scenario: Immature nouns are excluded explicitly rather than silently
    Given history, migrate, projects, and help are out of scope
    When the parity test runs
    Then those nouns are skipped via a named ignore-list
    And the ignore-list states why each noun is excluded

  Scenario: The CLI-to-skill coupling is recorded as a decision
    Given CLI surface drift recurred silently before this change
    When the ADR entry lands
    Then it is dated and states that a spur CLI surface change requires a same-change spur-cli update
    And it names the parity test as the enforcement mechanism

  Scenario: The TDD skill is renamed off the spur namespace
    Given the skill directory was plugins/sp/skills/spur-tdd
    When the rename lands
    Then the directory is plugins/sp/skills/test-driven-development
    And the skill frontmatter name field matches the directory
    And the ~11 live referencing files point at the new name
    And plugins/sp/tests/skill-structure.test.ts passes with the new name

  Scenario: Dispatch defaults to the native subagent
    Given a host platform that provides native subagents
    When an agent needs to dispatch work to another agent
    Then it uses the native subagent by default
    And it uses spur agent run only when a named escalation trigger applies
    And it states which trigger applied

  Scenario: Escalation triggers to spur agent run are observable
    Given the dispatch-surface reference is in place
    When an agent evaluates whether to escalate
    Then the triggers are a different model or coding agent, a headless or unattended step, a durable auditable run record, or workspace and credential isolation
    And each trigger is checkable without operator judgment

  Scenario: The dispatch rule composes with ADR-033 instead of duplicating it
    Given ADR-033 owns model-tier selection through the stage registry model_policy
    When the dispatch-surface reference is read
    Then it decides only which execution surface carries the work
    And it defers model tier selection to ADR-033

  Scenario: The contradictory fan-out guidance is corrected
    Given parallel-execution/SKILL.md told Claude Code to fan out via spur agent run
    When the dispatch-surface rule lands
    Then that line instructs native subagent fan-out on platforms that support it
    And the sandbox reliability tax on spur agent run is recorded

  Scenario: The refactor leaves the repository green
    Given the rescope, rename, parity test, and reference changes have landed
    When bun run lint and bun run test are run
    Then both pass
    And plugins/sp/tests/skill-structure.test.ts reflects the four-agent roster

  Scenario: dev-verifyall accepts --next like dev-verify
    Given dev-operations.md already referenced --next in verifyall dogfood guidance
    When the flag is declared
    Then dev-verifyall.md advertises --next in its argument-hint
    And the verifyall Inputs line in dev-operations.md documents it
    And a task with a PASS verdict transitions testing to done through the FSM
    And a task with a PARTIAL or FAIL verdict does not transition

  Scenario: dev-runall keeps no --next flag
    Given dev-runall drives the complete task pipeline for every task
    When the command surface is reviewed
    Then dev-runall declares no --next flag
    And the reason is recorded so the asymmetry with dev-run reads as deliberate

  Scenario: The dev-runall flag surface agrees across all three declarations
    Given --continue and --mode disagreed between dev-runall.md and dev-operations.md
    When the reconciliation lands
    Then dev-runall.md, the dev-operations.md command table, and the runall Inputs line declare the same flags
    And each flag has a stated meaning

  Scenario: Command flag drift fails the build
    Given a slash command declares flags in its argument-hint
    When the command parity check runs
    Then every declared flag appears in that command's dev-operations.md entry
    And a flag present in one and absent from the other fails the test
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0389 | Extract shared done-time housekeeping reference and repair agent skill frontmatter | done |
| 0390 | Author the dispatch-surface decision rule: native subagent versus spur agent run | done |
| 0391 | Create super-planner and rewrite super-coder as the build agent | done |
| 0392 | Sweep all references describing super-coder as the batch driver | done |
| 0393 | Rename skill spur-tdd to test-driven-development | done |
| 0394 | Refresh spur-cli references for the four Tier A nouns | done |
| 0395 | Promote agent, message, team, status, init, and serve to documented spur-cli nouns | done |
| 0396 | Gate CLI-to-skill parity with a test and record the coupling in an ADR | done |
| 0397 | Align batch command flag surfaces: add --next to dev-verifyall and reconcile dev-runall flags | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-31T03:53:22.062Z backlog → active (system)
- 2026-07-31T03:53:22.197Z active → verifying (system)
- 2026-07-31T04:03:45.663Z verifying → done (system)
