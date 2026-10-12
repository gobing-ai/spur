---
schema_version: 1
id: "F42"
name: "Deprecated feature status: frozen-but-retained lifecycle state with guarded consumers"
status: backlog
priority: P2
tags: []
created_at: "2026-10-12T05:18:10.497Z"
updated_at: "2026-10-12T05:18:42.886Z"
---

# F42: Deprecated feature status: frozen-but-retained lifecycle state with guarded consumers

## Goal

Give Spur a canonical, non-terminal `deprecated` feature status that marks a capability as retained in the tree but frozen: no new work or task links, edits discouraged, and the only expected change is its eventual removal — with every status-aware consumer treating it explicitly.

## Scope

**In scope**

- Domain SSOT: `deprecated` in `FEATURE_STATUSES`, icon, alias handling (`packages/domain/src/planning/schema.ts`); contracts/OpenAPI follow the enum.
- Lifecycle FSM: `deprecated` state and edges in `config/workflows/feature-lifecycle.yaml` (enter from `backlog`/`active`/`verifying`/`blocked`/`done`; exit to `active` (un-deprecate) or `cancelled` (removed)); regenerated bundle copy.
- Freeze guards: task create/update/batch-create `--feature` link rejection; task check finding for live tasks under a deprecated feature; advisory warning on deprecated-feature section writes.
- Derivation and routing: `feature sync`/`refresh` never auto-transition a deprecated feature; `feature advance` refuses it clearly; next-feature candidate selection skips it.
- Board: status icon/color, filter, `deprecate`/`undeprecate` actions in the Features module.
- Docs and skills: lifecycle design satellite, ADR entry for the vocabulary change, `sp:spur-cli` feature reference, next-feature skill, init-template parity.
- Durable affected-surface review recorded in the design satellite.

**Out of scope**

- Relabelling existing corpus features (e.g. `M`, `M3`, `M6`) — follow-up corpus work after the status ships.
- Deleting feature records or a `spur feature delete` verb.
- A new public flag to override the freeze; removal work lives in its own feature.
- Task-level `deprecated` status.

## Acceptance Criteria

```gherkin
Feature: Deprecated feature status

  @core
  Scenario: R1 — Deprecated is a canonical feature status across domain and contracts
    # covers: I1, I4
    Given the canonical feature status vocabulary
    When a feature file declares status deprecated and is listed, shown and validated
    Then deprecated is accepted as canonical, carries a presentation icon, round-trips through the feature contract, and unknown statuses still fail with the allowed set listed

  @core
  Scenario: R2 — The lifecycle graph retains a deprecated feature and allows only un-deprecation or removal exits
    # covers: I2, I3, I4
    Given a feature in backlog, active, verifying, blocked or done
    When it is transitioned to deprecated and later transitioned onward
    Then the feature file is retained with a History entry, deprecated is not terminal, the only legal exits are active and cancelled, and any other target is refused naming the legal edges

  @core
  Scenario: R3 — New work cannot be linked to a deprecated feature
    # covers: I3, I5
    Given a deprecated feature
    When a task is created, updated or batch-created with that feature id
    Then the link is refused before any task file is written, the message explains the freeze and points to a separate removal feature, and no parent reopen is attempted

  @core
  Scenario: R4 — Checks flag live work under a deprecated feature and advise on edits
    # covers: I3, I5
    Given a deprecated feature with a linked task that is not done or cancelled
    When task check and feature check run, and a feature section write targets the deprecated feature
    Then the task check reports a deprecated-parent finding with re-parent or cancel guidance, and the section write succeeds with a freeze warning in its result

  @core
  Scenario: R5 — Derivation and routing never pull a deprecated feature back into active work
    # covers: I3, I5
    Given a deprecated feature whose linked tasks are terminal or live
    When feature sync, feature refresh, feature advance and next-feature candidate selection run
    Then sync and refresh propose no status change, advance refuses with the un-deprecate command, and the deprecated feature is excluded from next-feature candidates

  @core
  Scenario: R6 — The Board shows deprecated features and offers deprecate and undeprecate actions
    # covers: I1, I5
    Given the Features module with features in every canonical status
    When the operator filters by status and opens a deprecated feature and a done feature
    Then deprecated has its own icon and filter entry, the done feature offers deprecate, and the deprecated feature offers only undeprecate and cancel

  @core
  Scenario: R7 — Owning documents and skills describe the deprecated status and its affected surfaces
    # covers: I5, I6
    Given the lifecycle design satellite, the ADR log, the spur-cli feature reference, the next-feature skill and the init workflow templates
    When the documentation contract checks run after the status ships
    Then each owner names deprecated with its edges and freeze semantics, the design satellite carries the affected-surface review, and the seeded feature-lifecycle template matches the source graph
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1179 | Deprecated status vocabulary and lifecycle graph | todo |
| 1180 | Deprecated freeze guards in task link, checks, derivation and advance | todo |
| 1181 | Board deprecated icon, filter and actions | todo |
| 1182 | Deprecated status documentation and skill parity | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
