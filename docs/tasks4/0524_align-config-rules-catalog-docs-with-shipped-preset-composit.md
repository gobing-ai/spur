---
template: feature-impl
schema_version: 1
name: "Align config/rules catalog docs with shipped preset composition"
description: ""
status: todo
type: task
profile: standard
feature_id: C1
parent_wbs: null
priority: P2
tags: ["rules", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T06:36:42.338Z"
updated_at: "2026-08-12T06:44:59.143Z"
---

## 0524. Align config/rules catalog docs with shipped preset composition

### Background
Closure audit of Feature C (Rules, 2026-08-11): the shipped functional surface satisfies its existing contract (verified live: run/validate/list/trace, ts-rule-engine integration, rule-run persistence, local catalog resolution). The only demonstrated gap is catalog documentation drift. This task implements Feature C1 R1–R6. Rubric: E1 D1 L1 C0 R0 = 3 → kept whole; doc-only alignment, zero CLI or rule-behavior change.

Verified drift: commit 79186391 added `strict` to `config/rules/recommended-pre-check.yaml` and bc267cc8 added `ui`, but `config/rules/README.md` (preset table, categories table, "Not absorbed" section), `config/rules/strict-check.yaml` header, and the `recommended-pre-check.yaml` header comment still describe the pre-change composition.
### Requirements
- [ ] R1. Update config/rules/README.md preset table: recommended-pre-check extends typescript, structure, boundary, surface, ui, strict
- [ ] R2. Update config/rules/README.md categories table: add live `migration` and `ui` categories
- [ ] R3. Reconcile config/rules/README.md 'Not absorbed (Spur-irrelevant)' section: the rg-migration preset and migration/rg-dialect rule are live shipped transitional helpers, not repo-absent
- [ ] R4. Fix config/rules/strict-check.yaml header comment: strict is part of recommended-pre-check since commit 79186391; strict-check remains the explicit single-rule cherry-pick surface
- [ ] R5. Fix config/rules/recommended-pre-check.yaml header comment to name strict among its extends
- [ ] R6. Verify: `spur rule list --json` presets/categories and the resolved recommended-pre-check rule set match the corrected documentation; no CLI verb/flag, rule YAML body, preset composition, or engine behavior changed
### Acceptance Criteria
```gherkin
Feature: Rule catalog docs

  Scenario: R1 — recommended-pre-check table matches its composition
    Given the shipped recommended-pre-check preset
    When an operator reads the preset table
    Then it lists typescript, structure, boundary, surface, ui, and strict

  Scenario: R2 — category table includes the live categories
    Given the shipped rule catalog
    When an operator reads the category table
    Then it includes migration and ui

  Scenario: R3 — shipped transitional helpers are documented as live
    Given the rg-migration preset and migration/rg-dialect rule are shipped
    When an operator reads the Not absorbed section
    Then neither helper is described as absent

  Scenario: R4 — strict-check header describes its current role
    Given strict is part of recommended-pre-check
    When an operator reads the strict-check header
    Then it describes strict-check as the explicit single-rule cherry-pick surface

  Scenario: R5 — recommended-pre-check header lists strict
    Given recommended-pre-check extends strict
    When an operator reads its header
    Then strict is named among its extends

  Scenario: R6 — documentation-only change preserves rule behavior
    Given the corrected catalog documentation
    When the rule inventory and recommended-pre-check resolution are inspected
    Then their presets, categories, and resolved rules match the documentation
    And no CLI surface, rule body, preset composition, or engine behavior changed
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: correct the catalog's self-description to match the shipped composition. WHY: operators decide gate membership from config/rules/README.md; it currently omits ui+strict from recommended-pre-check, omits the live migration/ui categories, and presents the shipped rg-migration preset as not shipped.

CHOSEN: doc-only edits to config/rules/README.md and the two preset header comments. REJECTED: removing strict/ui from recommended-pre-check (changes the default gate — operator consent territory, and 79186391 deliberately added them); deleting the strict-check preset or rg-migration (public CLI surface, needs consent); touching global-layer ~/.config/spur/rules strict headers (outside this repo).

INVARIANTS: no change to any rule YAML body, preset composition, CLI verb/flag, or engine behavior; the git diff is limited to config/rules/README.md, config/rules/strict-check.yaml, config/rules/recommended-pre-check.yaml.

KEY FACTS: config/rules/recommended-pre-check.yaml extends [typescript, structure, boundary, surface, ui, strict] (79186391, bc267cc8); config/rules/rg-migration.yaml and config/rules/migration/rg-dialect.yaml are live (listed by `spur rule list --json`); recommended-post-check extends [quality]; strict-check extends [strict].
### Plan
1. Read config/rules/README.md, recommended-pre-check.yaml, strict-check.yaml
2. Apply corrections R1-R5
3. Run `spur rule list --json`; confirm presets and categories match the corrected README
4. Run `spur rule list --preset recommended-pre-check --json`; confirm strict/ui rules are present
5. `git diff` shows only the three intended files
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature C1 — Rule surface contract and catalog integrity
- Parent group C — Rules
### History
