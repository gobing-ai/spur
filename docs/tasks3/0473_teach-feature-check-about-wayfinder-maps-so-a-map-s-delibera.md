---
template: feature-impl
schema_version: 1
name: "Teach feature check about wayfinder maps so a map's deliberate no-AC contract stops failing the BDD gate"
description: ""
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T06:24:37.133Z"
updated_at: "2026-08-07T06:25:35.227Z"
---

## 0473. Teach feature check about wayfinder maps so a map's deliberate no-AC contract stops failing the BDD gate

### Background
**Gate-correctness ticket.** Sibling to the ungraduated-fog detector under feature N: that one is a
gate that fails to fire, this one is a gate that fires when it must not. Both are corpus-gate
correctness.

#### The contradiction

`sp:wayfinder` charts an investigation map as a `spur feature`. Its charting checklist
(`plugins/sp/skills/wayfinder/SKILL.md`) states the contract explicitly:

> - [ ] Feature description has all **six sections**: Destination, Notes, Open questions,
>   Decisions so far (empty), Not yet specified, Out of scope.

**Acceptance Criteria is not one of them, by design.** A map's target is its `## Goal` / destination;
progress is measured by resolving child tickets, not by satisfying testable criteria. Both maps that
followed this contract say so in prose, in the AC section itself:

> **This feature is a wayfinder MAP, not an implementable feature.** It has no acceptance criteria —
> its target is the **## Goal** (destination).

`spur feature check` then hard-errors on exactly that:

```
L3.ac-bdd-error   — BDD: No Feature declaration found.
L3.ac-bdd-invalid — Acceptance Criteria validation failed; fix BDD syntax errors
```

So the skill tells an agent to produce a document the gate structurally rejects. Following the
documented process yields a permanently red feature.

#### Evidence

- Affected today: features **M** (Teams) and **F82** (feature-status feedback loop) — the two maps
  carrying the explicit disclaimer. Four of the eight entries in `config/corpus-baseline.json` are
  this single cause, reported twice per feature.
- **E1** (history data plane) is a map too and passes — only because whoever charted it authored real
  Gherkin AC anyway, contrary to the skill's six-section contract. So charting practice is already
  inconsistent, and the gate is what makes the inconsistency invisible: the compliant maps fail and
  the non-compliant one passes.
- This recurs on **every new map**. It is not two legacy documents; it is a standing defect in the
  charting path.

#### Why the fix belongs in the checker, not the maps

The tempting shortcut is to paste a stub `Feature:` block into M and F82 and move on. Reject it: that
is fabricated acceptance criteria for something that has none, invented purely to satisfy a validator.
It makes the corpus lie, and it teaches every future charting session to lie the same way. A map with
no AC is correct; the checker not knowing the map type is the defect.

#### Relationship to the fog detector

The ungraduated-fog check under this same feature needs to identify which features are maps (only a
map has `## Not yet specified`). If this ticket lands a first-class map marker, that check should
consume it rather than sniffing sections independently. Not a hard dependency in either direction —
but doing this one first makes the other simpler, so prefer that order.
### Requirements
- R1 — Give a wayfinder map a first-class, machine-readable marker that `spur feature check` can read, without inventing a parallel feature-type taxonomy.
- R2 — Skip the BDD Acceptance Criteria validation for a marked map, so a map's deliberate no-AC contract produces neither `L3.ac-bdd-error` nor `L3.ac-bdd-invalid`.
- R3 — Keep every non-AC check active for maps; a map must not become an unvalidated document class.
- R4 — Leave unmarked features exactly as strict as they are today, so this cannot become an opt-out for ordinary features that simply lack AC.
- R5 — Mark the two existing maps (M and F82) and remove their four now-obsolete entries from `config/corpus-baseline.json`, verifying `bun run corpus-check` reports zero stale entries afterward.
- R6 — Update `sp:wayfinder` so charting sets the marker, and align its six-section checklist with whatever the marker mechanism turns out to be.
- R7 — Reconcile feature E1, which is a map carrying real Gherkin AC contrary to the six-section contract: either mark it and keep its AC harmlessly, or leave it unmarked, and state which and why.
- R8 — Cover the behavior with tests: a marked map passes with no AC, an unmarked feature with no AC still fails, and a marked map still fails on non-AC defects.
### Acceptance Criteria
```gherkin
Feature: 0473 feature check understands wayfinder maps

  Scenario: R2 — a marked map with no acceptance criteria passes
    Given a feature marked as a wayfinder map
    And its Acceptance Criteria section carries a prose no-AC disclaimer
    When spur feature check runs against it
    Then no BDD acceptance-criteria error is reported

  Scenario: R4 — an unmarked feature with no acceptance criteria still fails
    Given an ordinary feature that is not marked as a map
    And its Acceptance Criteria section has no Gherkin Feature declaration
    When spur feature check runs against it
    Then the BDD acceptance-criteria error is still reported

  Scenario: R3 — a marked map is still validated on everything else
    Given a feature marked as a wayfinder map
    And it carries a non-AC structural defect
    When spur feature check runs against it
    Then that defect is still reported

  Scenario: R5 — the baseline shrinks by exactly the obsolete entries
    Given features M and F82 are marked as maps
    When bun run corpus-check runs after their baseline entries are removed
    Then it reports zero new and zero stale entries

  Scenario: R1 — the marker is machine-readable
    Given a charted wayfinder map
    When a tool inspects the feature to decide whether it is a map
    Then the marker is readable without parsing prose or section headings

  Scenario: R6 — charting sets the marker
    Given a new map charted through the wayfinder skill
    When the feature is created
    Then it carries the map marker without a manual follow-up edit

  Scenario: R7 — E1's disposition is explicit
    Given feature E1 is a map that carries real Gherkin acceptance criteria
    When this ticket is resolved
    Then E1 is either marked or deliberately left unmarked
    And the task body states which and why

  Scenario: R8 — the three behaviors are regression-tested
    Given the marked-map, unmarked-feature, and non-AC-defect cases
    When the test suite runs
    Then each has a passing assertion
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Design deferred to the implementer.** Constraints and the one real decision, below.

#### The decision: how a map is marked (R1)

| Option | Assessment |
| --- | --- |
| **`tags: ["wayfinder-map"]`** | `tags` is already `z.array(z.string()).optional()` on `featureFrontmatterSchema` (`packages/domain/src/planning/schema.ts:303-316`) and is currently unused by these two maps. **Zero schema change, zero migration.** Weakness: `tags` is free-form, so a typo silently means "not a map" — mitigate by exporting one constant and having the wayfinder skill write it. **Recommended starting point.** |
| New `kind: map \| feature` frontmatter field | Explicit and typo-proof, but costs a schema change, a migration for 60+ existing features, and a new taxonomy axis whose only member today is "map". Prefer only if `tags` proves insufficient in review. |
| Sniff the prose disclaimer or the `## Not yet specified` heading | **Reject.** Ties a gate to a sentence anyone may reword, and silently reclassifies any feature that happens to use the heading. |

#### Constraints

- **R4 is the load-bearing requirement.** The marker must be a positive assertion about a document
  class, never a suppression an ordinary feature can reach for to dodge AC authoring. Whatever
  mechanism is chosen, verify the escape hatch cannot be used that way — an unmarked feature with no
  AC must stay red.
- **Do not fabricate Gherkin** in M or F82 to satisfy the validator. See Background.
- **Do not widen the skip.** Only the two BDD AC findings are suppressed; every other layer stays on.

#### Sequencing note

Prefer landing this before the ungraduated-fog detector under this feature, so that check can consume
the map marker rather than independently sniffing for `## Not yet specified`.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
