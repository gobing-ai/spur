---
schema_version: 1
id: "A3"
name: "Harness surface governance: workflow composition measures and script-surface placement rules"
status: active
priority: P2
tags: []
created_at: "2026-08-20T23:10:47.090Z"
updated_at: "2026-08-21T15:16:15.310Z"
---

# A3: Harness surface governance: workflow composition measures and script-surface placement rules

## Goal
Give the harness's own authoring surfaces a written, measurable placement contract: every
deterministic workflow action has a detectable owner, and every new script lands on the correct one
of the project's four script surfaces. Authority is recorded in `docs/00_ADR.md`, applied by the
`sp` plugin's Spur-corpus specialists, and enforced advisory-only so no running workflow is ever
blocked by it.
## Scope
### In scope

- Amend **ADR-069** with mechanical detection measures for workflow composition: a line-count
  threshold for `shell` actions and a non-slash-invocation trigger for `agent.run` inputs, each
  paired with the recommended fix (the five owner options a–e already recorded in
  `docs/design/workflow-shell-ownership.md`, plus the centralized-skill fix for `agent.run`).
- Ship the composition advisory as a **warn-only** tier of the existing `spur workflow validate`
  surface, honouring the exception dispositions already recorded for the classified programs.
- Teach `plugins/sp/agents/expert-spur.md` and its backing skill (`sp:spur-cli`,
  `references/workflows.md`) how to measure and repair both defect classes.
- Amend **ADR-051** with a single placement table covering all four script surfaces
  (`apps/cli/src/commands`, `scripts/commands`, `package.json`, `plugins/sp/scripts`) and record the
  operator consent granted for this feature's public-surface changes.
- New CLI noun `spur self` hosting `init` / `migrate` / `serve` / `status`, with the four legacy
  standalone nouns retained as hidden aliases.
- New CLI noun `spur builder` with exactly two verbs, `bump-ver` and `drop-tags`, promoted from
  `scripts/spur-dev.ts`.
- A centralized definition site for shared `spur` CLI option declarations, with a parity check.
- `--fix` on `spur task check` and `spur feature check`, limited to structural repairs.
- Remove the `AUTH` column from `spur agent doctor` table output.
- New verb `spur workflow show`, rendering a workflow's FSM as a mermaid diagram inside a markdown
  code block.

### Out of scope

- Blocking any existing workflow run, or adding a failing gate to `spur-check` / `spur-check-new`
  for composition findings.
- Bulk migration of `scripts/spur-dev.ts` or `scripts/commands` into `spur builder` — only the two
  named verbs move; further promotions are separate, individually-justified work.
- Rewriting the shell programs or `agent.run` prompts that the new measures flag; this feature
  produces the measure, the advisory, and the guidance, not the migration.
- Re-opening the owner classification recorded in `docs/design/workflow-shell-ownership.md` or the
  bulk exception for the 92 transition guards.
- Removing the `authenticated` field from `spur agent doctor --json`; only the human table column
  is dropped.
- A section-delete verb for the corpus CLI, or any `--fix` behaviour that authors section content.
## Acceptance Criteria
```gherkin
Feature: Harness surface governance: workflow composition measures and script-surface placement rules

  @core
  Scenario: R1 — ADR-069 carries a mechanical shell composition measure with its fix options
    Given ADR-069 states that reusable deterministic behavior belongs to an owning module but names no detectable threshold
    When the decision record is amended
    Then it states a line-count threshold above which a shell action is reported as to-be-enhanced
    And it names the recommended fixes as the owner options already recorded for shell programs
    And the threshold is justified against the classified programs on this tree, not asserted

  @core
  Scenario: R2 — ADR-069 carries an agent.run composition measure keyed on non-slash invocation
    Given ADR-043 already prefers pure slash commands in agent.run inputs but attaches no measure
    When the decision record is amended
    Then a non-slash agent.run input is the condition that reports the action as to-be-enhanced
    And raw prompt length sets the reported severity rather than triggering the report
    And the recommended fix is to move the operation behind a centralized agent skill or slash command

  @core
  Scenario: R3 — The composition advisory warns and never blocks a run
    Given a workflow definition containing actions that exceed the recorded measures
    When the workflow is validated and when it is run
    Then each exceeding action is reported with its state, action key, measure, and recommended fix
    And the validation exit status is unchanged by composition findings alone
    And the run executes every action it would have executed without the advisory

  @core
  Scenario: R4 — Actions with a recorded owner disposition are not reported
    Given programs already classified with a deliberate disposition in the composition records
    When the advisory runs over the shipped workflow definitions
    Then a classified program is not reported merely for exceeding the threshold
    And an action with no recorded disposition that exceeds a measure is reported
    And the report names how many actions were suppressed by a recorded disposition

  @core
  Scenario: R5 — expert-spur and its backing reference teach measuring and fixing composition defects
    Given a corpus steward asked to review or author a workflow definition
    When it consults the sp plugin's Spur-corpus guidance
    Then the guidance states both measures and how to run the advisory
    And it maps each defect class to its recommended fix path
    And it states that findings are advisory and never justify blocking or editing a running pipeline

  @core
  Scenario: R6 — ADR-051 records the four-surface placement table and this feature's consent
    Given script placement is governed by two partial records that omit package.json entries entirely
    When ADR-051 is amended
    Then one table names all four script surfaces with the condition that selects each
    And the amendment records the operator consent granted for this feature's public surface changes
    And the plugin-script contract remains owned by its existing record rather than being restated

  @core
  Scenario: R7 — spur self hosts the self-management verbs with the legacy nouns preserved
    Given init, migrate, serve, and status are standalone top-level nouns today
    When the self noun ships
    Then each verb is reachable as spur self <verb> with behavior identical to the legacy noun
    And each legacy noun keeps working unchanged for existing scripts and workflows
    And the legacy nouns are hidden from the top-level help listing while self is listed

  @core
  Scenario: R8 — spur builder exposes exactly the two promoted verbs
    Given release plumbing that is genuinely useful to any project rather than to this monorepo alone
    When the builder noun ships
    Then bump-ver and drop-tags are reachable as spur builder verbs with behavior matching their internal originals
    And no further internal command is promoted as part of this work
    And the record states that each future promotion needs its own justification

  @core
  Scenario: R9 — Shared CLI option declarations resolve from one definition site
    Given the same option is declared independently across many command modules
    When a shared option is used by two or more commands
    Then its flag string and description come from a single definition site
    And a check fails when a command re-declares a shared option with divergent wording
    And every command's resolved help output is unchanged by the consolidation

  @core
  Scenario: R10 — spur task check --fix repairs structural task defects only
    Given a task file with structural findings such as a missing, mis-levelled, or mis-ordered section heading
    When the check is run with --fix
    Then the structural findings are repaired in place and the repairs are reported per file
    And findings that would require authoring content are left untouched and still reported
    And re-running the check without --fix reports no remaining structural findings

  @core
  Scenario: R11 — spur feature check --fix repairs structural feature defects only
    Given a feature file with structural findings in its section layout
    When the check is run with --fix
    Then the structural findings are repaired in place and the repairs are reported per file
    And acceptance-criteria content findings are left untouched and still reported
    And re-running the check without --fix reports no remaining structural findings

  @core
  Scenario: R12 — spur agent doctor omits the AUTH column from its table
    Given the auth signal is unreliable and misreports usable agents
    When the doctor table is rendered
    Then no AUTH column appears in the table output
    And the remaining columns stay aligned with their headers
    And the tier-1 summary footer is unchanged

  @core
  Scenario: R13 — spur workflow show renders the FSM as a mermaid diagram
    Given a valid workflow definition file
    When spur workflow show is run against it
    Then the output is a markdown snippet containing a fenced mermaid code block
    And the diagram carries every declared state and every transition between them
    And terminal and failure states are visually distinguished from ordinary states

  @edge
  Scenario: R14 — Transition guards are outside the composition advisory
    Given transition guards that are single boolean predicates covered by a recorded bulk exception
    When the advisory runs
    Then no guard is reported regardless of its length
    And the recorded bulk exception is cited as the reason

  @edge
  Scenario: R15 — --fix is a no-op on a corpus file with nothing structural to repair
    Given a task or feature file whose only findings are content-level
    When the check is run with --fix
    Then the file is left byte-identical
    And the content findings are reported exactly as they are without --fix

  @edge
  Scenario: R16 — Machine-readable doctor output keeps the auth field
    Given consumers that classify authentication failures from doctor output
    When spur agent doctor is run with --json
    Then the authenticated field is still present for every agent
    And only the human table rendering drops the column

  @edge
  Scenario: R17 — spur workflow show fails cleanly on an unusable definition
    Given a workflow file that is missing or fails to parse
    When spur workflow show is run against it
    Then the command exits non-zero naming the file and the parse failure
    And no partial diagram is emitted
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0613 | Record the composition measures and the four-surface script placement rule as authority | todo |
| 0614 | Ship the warn-only workflow composition advisory on spur workflow validate | todo |
| 0615 | Teach expert-spur and the spur-cli workflow reference to measure and fix composition defects | todo |
| 0616 | Add the spur self noun and hide the four legacy standalone nouns behind it | todo |
| 0617 | Add the spur builder noun with bump-ver and drop-tags promoted from spur-dev | todo |
| 0618 | Consolidate shared spur CLI option declarations behind one definition site | todo |
| 0619 | Add --fix to spur task check and spur feature check for structural repairs | todo |
| 0620 | Add spur workflow show to render a workflow FSM as a mermaid diagram | todo |
| 0621 | Remove the unreliable AUTH column from spur agent doctor table output | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-21T15:16:15.310Z backlog → active (system)
