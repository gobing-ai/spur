---
name: ac-style-guide
description: BDD acceptance criteria authoring conventions for spur-dev — R-numbering, two AC tiers, scenario-title stability, Gherkin template usage.
see_also:
  - spur-dev
---

# AC Style Guide

Conventions for authoring BDD acceptance criteria in feature files. These are what `spur feature check`
validates and what task decomposition maps against.

## R-numbering

Every scenario carries an `R1, R2, …` prefix in its title:

```gherkin
Scenario: R1 — User can create a task with required fields
Scenario: R2 — Task creation fails gracefully on missing title
```

Rules:

- **Sequential within a feature** — start at R1 for each feature.
- **Stable forever** — never renumber after tasks are created. If you add a scenario, take
  the next free number.
- **One R-number = one scenario.** Never split a requirement across multiple scenarios
  under the same R-number; never merge two requirements into one scenario.

## Two AC tiers (authoring convention)

A planning convention (DD-06 "permissive start"), not a `spur feature check` feature today —
the validator currently checks all scenarios uniformly (Gherkin syntax + traceability). Tag
scenarios so decomposition and future tiered gating can tell them apart:

### Core tier (the work that must ship)

Every core scenario should:

- Be testable (given-when-then with concrete values).
- Cover a committed scope item from the feature's `## Scope (in)`.
- Map to at least one task in decomposition.

Tag core scenarios `@core`:

```gherkin
@core
Scenario: R1 — User can create a task with required fields
```

### Edge-case tier (advisory)

Edge-case scenarios cover error paths, boundary values, and degraded modes; may be deferred and
need not map to a task in the initial decomposition. Tag them `@edge`:

```gherkin
@edge
Scenario: R5 — Task creation handles 10,000-character title gracefully
```

DD-06 permissive start: treat only the core tier as must-ship initially; promote edge cases that
prove important in a later iteration. (When tiered gating lands in `spur feature check`, these tags
become the gate input — the CLI stays the validator; this guide stays the convention.)

## Scenario-title stability

The scenario title is the **identity key** for traceability. When a task references a
scenario, it matches by title. Rules:

- **Never rename a scenario after task decomposition.** If the requirement changes, add a
  new scenario and deprecate the old one (leave it, mark `@deprecated`).
- **Keep titles descriptive and unique.** "User can log in" is ambiguous — "R3 —
  Registered user can log in with email and password" is traceable.
- **No synonyms in cross-references.** The title in the feature file and the title in the
  task's AC reference must be byte-identical.

## Gherkin template

Use the canonical BDD template at `.spur/templates/bdd/gherkin.md`. Key rules:

- **Given** establishes preconditions (state, setup).
- **When** describes the single action under test.
- **Then** asserts the observable outcome.
- **And** chains additional preconditions, actions, or assertions.

Avoid:

- Multiple `When` clauses in one scenario — split into separate scenarios.
- Vague assertions ("the system works correctly") — name the observable.
- Implementation details in scenarios ("the button with id #create-task is clicked") —
  describe the user intent.

## AC → task mapping

During decomposition, each core scenario maps to ≥1 task:

| Scenario | Task(s) | Rationale |
|----------|---------|-----------|
| R1 — Create task with required fields | 0042 | Direct implementation |
| R3 — Login with email and password | 0043, 0044 | Auth service + UI |

The mapping is recorded in the task's `## Background` or in the feature's `## Notes`.
`spur feature check` warns on unmapped core scenarios after `spur feature refresh`
regenerates the `## Tasks` block.

## Decision-trace → AC-scenario mapping

Each resolved decision from a grilling interview (Phase 1) becomes one or more Gherkin scenarios:

| Decision-tree element | Becomes |
|-----------------------|---------|
| A **locked decision** (a capability the feature commits to) | A `@core` scenario — the must-ship behavior it enables |
| The decision's **observable outcome** (why it was chosen) | The scenario's `Then` — assert the observable, not the mechanism |
| A decision's **preconditions / constraints** | The scenario's `Given` |
| The **user action** that exercises the decision | The scenario's single `When` (one action per scenario — split if more) |
| An **error path / boundary** surfaced during grilling | An `@edge` scenario (advisory; may defer per DD-06) |
| A **deferred branch** ("out of scope for now") | A `## Scope` **Out** bullet — *not* a scenario |

Number scenarios `R1, R2, …` sequentially, stable forever (the title is the traceability identity
key). Use the Gherkin template at `.spur/templates/bdd/gherkin.md`.
