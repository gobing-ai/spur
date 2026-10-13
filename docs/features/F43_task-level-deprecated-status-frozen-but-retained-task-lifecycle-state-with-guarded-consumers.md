---
schema_version: 1
id: "F43"
name: "Task-level deprecated status: frozen-but-retained task lifecycle state with guarded consumers"
status: backlog
priority: P2
tags: []
created_at: "2026-10-13T16:46:48.295Z"
updated_at: "2026-10-13T16:47:30.804Z"
---

# F43: Task-level deprecated status: frozen-but-retained task lifecycle state with guarded consumers

## Goal

Give the task lifecycle the retained-but-frozen status the feature lifecycle already has: a task
can be marked deprecated so its record stays readable and countable while no new work attaches to
it, no forward transition starts it, and leaving the state is explicit.

## Scope

**In scope**

- `deprecated` in the canonical `TaskStatus` vocabulary (domain SSOT, icon, aliases); contracts follow the enum.
- Task-lifecycle FSM state and edges (`backlog`/`todo`/`wip`/`testing`/`blocked`/`done` → `deprecated`; exits only to `todo` and `cancelled`), plus the regenerated bundle copy.
- Freeze guards: dependency-link refusal at create/update/batch-create, pipeline-admission refusal, a `task check` finding for live dependents, an advisory warning on deprecated-task section writes.
- Derivation and routing: `task advance` refuses with the un-deprecate hint, next-router/dev-run never start a deprecated task, feature sync reads it as terminal-linked.
- Board Tasks module: status icon/color, filter, deprecate/undeprecate actions.
- Docs, ADR, `sp:spur-cli` task reference, init-template parity, and a durable affected-surface review in the design satellite.

**Out of scope**

- Deleting task records or adding a `task delete` verb.
- Relabelling existing corpus tasks onto the new status (follow-up sweep).
- A public flag that overrides the freeze.
- Changing feature-level `deprecated` semantics (F42/ADR-136 stays authoritative).

## Acceptance Criteria

```gherkin
Feature: Task-level deprecated status

  @core
  Scenario: R1 — Deprecated is a canonical task status across domain and contracts
    # covers: I1
    Given the canonical task status vocabulary
    When a task file declares status deprecated and is listed, shown and validated
    Then deprecated is accepted as canonical, carries a presentation icon, round-trips through the task contract, and unknown statuses still fail with the allowed set listed

  @core
  Scenario: R2 — The lifecycle graph retains a deprecated task and allows only un-deprecation or removal exits
    # covers: I2
    Given a task in backlog, todo, wip, testing, blocked or done
    When it is transitioned to deprecated and later transitioned onward
    Then the task file is retained with a History entry, deprecated is not terminal, the only legal exits are todo and cancelled, and any other target is refused naming the legal edges

  @core
  Scenario: R3 — New dependency links onto a deprecated task are refused before any write
    # covers: I3
    Given a deprecated task
    When a second task is created, updated or batch-created with a depends_on edge to it
    Then the edge is refused before any task file is written, the message explains the freeze and names the un-deprecate command, and the record is never silently rewritten

  @core
  Scenario: R4 — A deprecated task never starts, advances or gets routed
    # covers: I4, I7, I8
    Given a deprecated task
    When pipeline admission, task advance and the next-router routing run against it
    Then admission is refused, advance refuses with the un-deprecate command named, and routing selects no deprecated task as its next step

  @core
  Scenario: R5 — Checks flag live dependents and section writes are warned about
    # covers: I5, I6
    Given a deprecated task with a dependent task that is not done or cancelled
    When task check runs and a section write targets the deprecated task
    Then the check reports a deprecated-task finding with re-point or un-deprecate guidance, and the section write succeeds with a freeze warning in its result

  @edge
  Scenario: R6 — Derivation reads a deprecated task as terminal-linked work
    # covers: I9
    Given a feature whose only remaining linked task is deprecated
    When feature sync and the feature verification pass evaluate the feature
    Then the deprecated task counts as terminal-linked and never blocks the feature's exit from verifying

  @core
  Scenario: R7 — The Board shows deprecated tasks with deprecate and undeprecate actions
    # covers: I10
    Given the Tasks module listing tasks in every canonical status
    When a deprecated task is displayed and filtered
    Then it carries its status icon and colour, the filter selects it by status, and the module offers deprecate and undeprecate actions that write the transition

  @core
  Scenario: R8 — Owner docs and skills record the vocabulary change and its affected surfaces
    # covers: I11, I12
    Given the task deprecated status ships
    When a maintainer reads the task lifecycle design satellite, the ADR entry and the task CLI reference
    Then the frozen semantics, the legal edges and the affected-surface review are recorded, and the init template and bundled lifecycle copy match the shipped graph

  @edge
  Scenario: R9 — Only status-moving writes are frozen, and existing edges are never rewritten
    # covers: I16
    Given a task deprecated while another task already declares depends_on to it
    When the pipeline's own task-file hops (record, anchor migration, verdict write) run and when a new status write is attempted
    Then the documented exempt hops succeed, the status write is refused unless it targets todo or cancelled, and the pre-existing dependency edge is reported and left intact
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1189 | Deprecated task status vocabulary and lifecycle graph | todo |
| 1190 | Deprecated task freeze guards in dependency resolution, admission, checks and status writes | todo |
| 1191 | Deprecated task derivation, routing and Board surfaces | todo |
| 1192 | Deprecated task status documentation, skill parity and surface-review closure | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
