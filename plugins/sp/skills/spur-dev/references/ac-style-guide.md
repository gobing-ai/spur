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

## Two AC tiers

### Core tier (must-pass gate)

Scenarios that `spur feature check` gates on. Every core scenario must:

- Be testable (given-when-then with concrete values).
- Cover a committed scope item from the feature's `## Scope (in)`.
- Map to at least one task in decomposition.

Mark core scenarios with `[core]` in a comment or tag:

```gherkin
@core
Scenario: R1 — User can create a task with required fields
```

### Edge-case tier (advisory)

Scenarios that `spur feature check` warns on but does not gate. Edge-case scenarios:

- Cover error paths, boundary values, and degraded modes.
- May be deferred to a later iteration.
- Are not required to map to a task in the initial decomposition.

Mark edge-case scenarios with `[edge]`:

```gherkin
@edge
Scenario: R5 — Task creation handles 10,000-character title gracefully
```

The permissive start (DD-06): the initial matrix gates only the core tier. Edge-case
scenarios that prove important in practice are promoted to core in a later iteration.

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

Use the canonical BDD template at `config/templates/bdd/gherkin.md`. Key rules:

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
