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

## Verdict AC ↔ feature scenario linkage

How a verify-answer AC table connects back to a feature scenario. Added by task 0398 R8 after the
H6 batch rediscovered this contract by failure, across three regeneration cycles.

### The AC table shape

`spur task verdict <wbs> --from-answer <file>` parses a four-column table. Both the header and the
column order matter:

```markdown
| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R3 — Batch report names every skipped task | MET | test | `tests/batch.test.ts:88`; `bun test` exit 0 |
```

- **Status** — `MET` · `PARTIAL` · `UNMET` · `N/A`.
- **Evidence Type** — `test` · `command` · `static-ref` (aliases: `static`, `doc`, `docs`,
  `documentation`) · `manual-review` (alias `manual`) · `llm-judge` (alias `judge`) · `n/a`.

A row whose status or evidence type cannot be parsed is **omitted from the verdict**, but the
omission is now reported as an `ac-row-dropped` check naming the row and the unrecognised value
(0398 R6). If a verdict comes back with fewer AC rows than you authored, read that check.

### Four accepted id forms

`rowMatchesScenario` accepts any of these as naming the feature scenario `R3 — Foo`:

| Form | Example |
| ------ | --------- |
| Exact title | `R3 — Foo` |
| Bare title (R-prefix dropped) | `Foo` |
| `Scenario:` prefix | `Scenario: R3 — Foo` |
| `AC-N` positional alias | `AC-3` |

Any of the four may additionally carry a **bracket tag** in any position — `[doc-only] R3 — Foo`,
`Scenario: [advisory] Foo`. Tags are stripped before matching (0398 R7), so tagging never breaks
the linkage.

### The id is exactly the scenario title — no Gherkin body appended

An AC row id must be **exactly** the scenario title (plus any of the four forms above), with the
Gherkin body left in the task's `### Acceptance Criteria` block. Never append the scenario's
`Given … / When … / Then …` steps to the row id:

```markdown
| R3 — Foo | MET | test | `tests/foo.test.ts:12` |        ← correct
| Scenario: R3 — Foo (Given … / When … / Then …) | MET | test | … |  ← never
```

The verifier preserves row ids verbatim in the verdict artifact (evidence is not rewritten), and
the feature scenario gate strips a trailing parenthetical only as a *backstop* for artifacts that
already carry one (0561). Appending the body is still a contract violation and makes the row
unmatchable in edge cases (a title that legitimately ends in `(...)` plus a body), so keep ids
clean at authoring time.

### Which tags exempt a row from executable evidence

A `MET` row is silently demoted to `PARTIAL` unless it carries `test` or `command` evidence — the
executable-evidence rule. Five tags opt a row out, because not every scenario is behavioral:

`[doc-only]` · `[docs-only]` · `[non-behavior]` · `[advisory]` · `[non-core]`

Use one when the scenario asserts documentation or a design decision, and pair it with
`static-ref`. Do **not** manufacture a token test to dodge the rule — that is the failure mode this
contract exists to prevent.

```markdown
| [doc-only] R7 — The linkage contract is written down | MET | static-ref | `ac-style-guide.md` § linkage |
```

> Before 0398 R7 this row was unusable: the tag was required to keep `MET`, but the tag also broke
> title matching, so the scenario read as unverified. Both halves now hold at once.

### What `--strict` advance requires

`spur feature advance <id> --to done --strict` treats a scenario as verified only when **all** of
these hold:

1. A task links to the feature (`feature_id`) and is status `done`.
2. That task has a verdict artifact at `.spur/run/<wbs>-verdict.json` with top-level `PASS`.
3. That artifact carries a row — in `requirements` **or** `acceptanceCriteria` — whose id matches
   the scenario by one of the four forms above, with status `MET`.

Anything less emits `L4.scenario-unverified`.

### Cover every declared scenario, not just the gate's minimum

`spur feature check` only needs **one** matching MET row per *feature* scenario. Satisfying just
those leaves per-task AC coverage incomplete and nothing will flag it — H6 shipped nine tasks at
23/48 scenario coverage, one with an empty `acceptanceCriteria` array, and every gate still passed.
Author one row per scenario declared in the task's own `### Acceptance Criteria`.

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
| ----------------------- | --------- |
| A **locked decision** (a capability the feature commits to) | A `@core` scenario — the must-ship behavior it enables |
| The decision's **observable outcome** (why it was chosen) | The scenario's `Then` — assert the observable, not the mechanism |
| A decision's **preconditions / constraints** | The scenario's `Given` |
| The **user action** that exercises the decision | The scenario's single `When` (one action per scenario — split if more) |
| An **error path / boundary** surfaced during grilling | An `@edge` scenario (advisory; may defer per DD-06) |
| A **deferred branch** ("out of scope for now") | A `## Scope` **Out** bullet — *not* a scenario |

Number scenarios `R1, R2, …` sequentially, stable forever (the title is the traceability identity
key). Use the Gherkin template at `.spur/templates/bdd/gherkin.md`.

## AC altitude (task 0584 / ADR-062)

A task must declare, via the `ac_altitude` frontmatter field, whether its AC scenarios are the
feature's ship contract or a finer-grained local contract. The field is the **only** input — it is
never inferred from `template`, `status`, or whether the AC uses Gherkin (R4).

| `ac_altitude` | Meaning | DD-09 subset rule |
| --- | --- | --- |
| `graduating` (or absent) | Task scenarios are ship-contract criteria that graduate the feature's AC | Enforced — every task scenario must match a linked-feature scenario by normalized title. Drifted titles still report (R5). |
| `task-local` | Task criteria sit at a finer altitude than the feature's ship contract (fix-task regression criteria, per-defect cases) | Skipped — no uncovered-scenario findings regardless of title drift (R3) |

Use `task-local` for a fix/refactor task whose regression criteria are not the feature's ship
contract. Keep a `graduating` task's scenario titles identical to the feature's so DD-09 stays
satisfied. Absent-altitude is `graduating` — set `task-local` explicitly only where the subset rule
truly does not apply (do not silently default new tasks to it).
