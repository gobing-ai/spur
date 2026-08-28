---
schema_version: 1
id: "D7"
name: "Workflow todo projection: show --format for deterministic plan rendering"
status: done
priority: P2
tags: []
created_at: "2026-08-27T23:55:37.175Z"
updated_at: "2026-08-28T04:59:41.504Z"
---

# D7: Workflow todo projection: show --format for deterministic plan rendering

## Goal

Give `spur workflow show` a second projection of the resolved workflow definition — an ordered,
checkbox-shaped step list — so an agent driving a workflow obtains the plan from one deterministic
CLI call instead of parsing the YAML itself.

The concrete consumer exists today and is served by prose: `inline-pipeline-driver.md` § Run setup
step 4 (task 0596) instructs the driver to read `task-pipeline.yaml` and hand-build a two-layer todo
list. This feature replaces that hand-parsing with a tested renderer, and makes the projection honest
about each engine kind — a transition-flow DAG yields a topologically ordered checklist, a
state-machine yields a declared step inventory with branch, loop-back, and conditional entry marked
rather than a fake linear path.

## Scope

- In: a `--format <mermaid|todo>` option on `spur workflow show`, defaulting to `mermaid` so today's
  output is byte-identical for existing callers.
- In: a `--json` option on `spur workflow show`, carrying the machine shape of whichever format is
  selected (the primary consumer is an agent).
- In: a todo renderer that is kind-aware — `transition-flow` renders in topological edge order;
  `state-machine` renders declared state order labelled as an inventory, marking the initial state,
  terminal states, HITL pause states, loop-back transitions, and conditionally-entered states.
- In: colocating the todo renderer with `renderRunPlan` in `packages/app/src/workflow/` so the
  run-start plan preview and the new projection are one renderer with two callers and cannot drift.
- In: replacing the hand-parsing prose in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
  § Run setup step 4 with the CLI call, and the corresponding `sp:spur-cli` workflows reference row.
- In: the ADR-051 public-surface consent record for the `show` flag additions, plus same-commit
  `docs/04_DESIGN.md` sync (T3).
- Out: any caching or memoization of the rendered todo. The parse is single-digit milliseconds and
  the render is pure; a cache buys an invalidation bug class and a stale-output failure mode for no
  measured gain. Revisit only on evidence.
- Out: `--vars` resolution of conditional states. v1 marks a state conditional; it does not predict
  whether it will be entered. Add only when the inline driver demonstrably needs it.
- Out: a new `spur workflow todo` verb, and a boolean `--todo` flag. Both were considered and
  rejected at the idea gate in favour of `--format`.
- Out: any change to run-time behaviour of `spur workflow run`, its plan preview text, or the engine.
- Out: predicting the actual execution path of a branching state machine.

## Acceptance Criteria
```gherkin
Feature: Workflow todo projection: show --format for deterministic plan rendering

  @core
  Scenario: R1 — spur workflow show without --format renders the mermaid diagram unchanged
    Given a valid workflow definition file resolvable by the two-tier project-then-bundled lookup
    When "spur workflow show <file>" is run with no --format option
    Then stdout is byte-identical to the output produced before the flag was introduced
    And the exit code is 0

  @core
  Scenario: R2 — --format todo renders a transition-flow definition in declared node order with node-type markers
    Given a workflow definition whose kind is transition-flow
    When "spur workflow show <file> --format todo" is run
    Then every node id appears exactly once as an unchecked checkbox item in declaration order
    And the initialNode is marked initial and nodes listed in terminalNodes are marked terminal
    And node type gate, decision, and parallel are labelled on their items
    And no topological reordering is applied

  @core
  Scenario: R3 — --format todo renders a state-machine definition as a declared step inventory
    Given a workflow definition whose kind is state-machine with at least one loop-back transition
    When "spur workflow show <file> --format todo" is run
    Then every state id appears exactly once as an unchecked checkbox item in declaration order
    And the output declares that the list is a declared inventory rather than a predicted execution path
    And the initialState is marked initial, terminal states are marked terminal, and failure states are marked failure
    And every state carrying pause true is marked as an operator pause
    And each state that is the target of a transition whose source is declared later is marked loop-back
    And a state entered only through guarded transitions is marked conditional

  @core
  Scenario: R4 — --json emits the machine shape of the selected format
    Given a valid workflow definition file
    When "spur workflow show <file> --format todo --json" is run
    Then stdout parses as JSON
    And the payload carries the workflow name, its kind, and an ordered array of step objects
    And each step object carries its id and its markers for initial, terminal, pause, loop-back, and conditional
    And "spur workflow show <file> --json" with no --format returns the mermaid projection in the same envelope

  @core
  Scenario: R5 — the todo projection and the run-start plan preview share one step builder
    Given a single exported step-builder function that turns a WorkflowDef into an ordered step list
    When renderRunPlan and the todo renderer are both invoked on the same definition
    Then both derive their step sequence from that one builder
    And no independent step-sequence derivation exists in the todo or plan path

  @core
  Scenario: R6 — the inline pipeline driver calls the CLI instead of hand-parsing the YAML
    Given plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md Run setup step 4
    When the reference is read after this feature ships
    Then step 4 instructs the driver to obtain layer 1 from "spur workflow show <file> --format todo --json"
    And it no longer instructs the driver to copy or hand-derive the state list
    And the sp:spur-cli workflows reference row for show lists the --format and --json options
    And docs/04_DESIGN.md documents the show option surface in the same commit as the code

  @edge
  Scenario: R7 — an unrecognised --format value fails with a non-zero exit naming the accepted values
    Given a valid workflow definition file
    When "spur workflow show <file> --format outline" is run
    Then the exit code is non-zero
    And stderr names both accepted values mermaid and todo

  @edge
  Scenario: R8 — an unresolvable or invalid definition fails identically for every format
    Given a workflow file path that does not resolve, or a file that fails schema validation
    When "spur workflow show <file> --format todo" is run
    Then the exit code is 1
    And the error message is the same one the mermaid path emits for that condition
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0695 | Kind-aware workflow todo renderer and spur workflow show --format/--json | done |
| 0696 | Route the inline pipeline driver and spur-cli reference to the todo projection | done |
<!-- END AUTO-GENERATED -->

## Notes
**Premise correction (refine, `--depth ready`).** Every workflow definition shipped in
`config/workflows/` is `kind: state-machine`; the repository contains zero `transition-flow`
definitions, and the concrete consumer (`task-pipeline.yaml`) is a state machine. Scenario R2
originally required a *topologically ordered* transition-flow checklist. That ordering would have
been a Kahn sort plus cycle handling written for a kind nothing in the corpus uses, so R2 was
retitled to declaration order with node-type markers before any task referenced it. Revisit only if
a transition-flow definition lands whose declaration order is not already a valid execution order.

**Rejected at the idea gate (ADR-051 public-surface consent).**

- Boolean `--todo` — does not scale past a third projection (mutually exclusive booleans).
- A separate `spur workflow todo` verb — duplicates `show`'s file resolution, schema validation, and
  error paths for a different output encoding only.
- Caching the rendered todo — the parse is single-digit milliseconds and the render is pure; a cache
  buys an invalidation bug class and a stale-output failure mode for no measured gain.
## History
- 2026-08-28T04:47:13.345Z backlog → active (system)
- 2026-08-28T04:48:06.348Z active → verifying (system)
- 2026-08-28T04:59:41.504Z verifying → done (system)
