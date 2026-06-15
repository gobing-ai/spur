---
name: feature-acceptance-criteria
description: Gherkin template, R-numbering, @core/@edge tiers, and traceability mechanics for feature acceptance criteria.
see_also:
  - spur-features
---

# Authoring acceptance criteria

AC lives in a feature's `## Acceptance Criteria` section. It is the contract `spur feature check`
validates (L3 syntax + L4 traceability) and the surface task decomposition maps against. Two
formats are accepted.

## Gherkin (the default)

```gherkin
Feature: Planning layer

  @core
  Scenario: R1 — User can create a task with required fields
    Given a project with a tasks folder
    When the user runs `spur task create "Add validation"`
    Then a task file is written with a fresh WBS

  @edge
  Scenario: R2 — Task creation fails gracefully on a missing title
    Given a project with a tasks folder
    When the user runs `spur task create` with no title
    Then the CLI exits non-zero with a clear message
```

## Checklist (lightweight alternative)

For features that don't warrant full Gherkin, a checklist is accepted:

```markdown
- [ ] R1 — User can create a task with required fields
- [ ] R2 — Task creation fails gracefully on a missing title
```

`check` validates whichever format is present. Prefer Gherkin once scenarios have concrete
given-when-then values; a checklist is fine for early, coarse AC.

## R-numbering

Every scenario/item carries an `R1, R2, …` prefix:

- **Sequential within a feature**, starting at R1.
- **Stable forever.** Never renumber once tasks exist — tasks match AC by **normalized scenario
  title** (the `R<n> —` prefix is stripped on comparison), so renumbering around a title is safe
  but *rewording* a title breaks the coverage edge.
- **One R-number = one scenario.** Don't split one requirement across scenarios under a single
  R-number; don't merge two requirements into one scenario.

## Two tiers — `@core` / `@edge`

A planning convention (DD-06 "permissive start"), **not** a `check` gating feature today — the
validator treats all scenarios uniformly (syntax + traceability). Tags exist so decomposition and
future tiered gating can tell them apart:

- **`@core`** — must ship; covers a committed `## Scope (in)` item; maps to ≥ 1 task in decomposition.
- **`@edge`** — advisory error/boundary/degraded paths; may be deferred; need not map to a task
  initially.

Full rationale and the relationship to decomposition live in `sp:spur-dev`'s AC style guide — this
reference is the *authoring* surface; that one is the *planning* surface.

## Traceability mechanics (L4)

`check`'s L4 layer reads two things:

1. **Incoming edges** — tasks whose frontmatter `feature-id` points at this feature. Create tasks
   with `spur task create … --feature <id>` so the edge exists.
2. **Coverage** — which scenarios are claimed by a task (matched on normalized title).

L4 flags:

- **Orphan scenarios** — AC with no covering task (a gap in decomposition).
- **Coverage orphans** — a task claims a scenario title that no longer exists (usually a reworded AC).
- **`verifying` readiness** — moving a feature to `verifying` requires its core AC to be covered.

Run `spur feature check <id> --json` before transitioning to `verifying` and clear these.
