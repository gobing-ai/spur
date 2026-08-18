---
schema_version: 1
id: "F91"
name: "Corpus gate integrity: content-verified evidence anchors, external-evidence notation, AC-altitude carve-out, and a two-sided warning ratchet"
status: active
priority: P2
tags: []
created_at: "2026-08-17T22:15:08.187Z"
updated_at: "2026-08-18T00:10:12.783Z"
---

# F91: Corpus gate integrity: content-verified evidence anchors, external-evidence notation, AC-altitude carve-out, and a two-sided warning ratchet

## Goal
Make the task-corpus gates tell the truth about evidence, and make sure they keep telling it.

A 2026-08-17 audit of feature E5 found four gate defects that are not E5's — they are corpus-wide,
and three of them are consequences of the fourth:

| # | Defect | Blast radius (measured 2026-08-17, `spur task check` over all 582 tasks) |
| --- | --- | --- |
| RC-1 | The evidence-anchor gate validates existence + line bounds, never content, so an anchor that drifts onto unrelated code passes silently | 18 anchors in tasks 0553/0554/0555 pointed at unrelated code while the gate reported **0 warnings** |
| RC-2 | One citation notation exists and it is repo-root-relative, so in-repo paths get written incompletely and evidence outside the repo has **no legal form at all** | **851** `L4.stale-line-anchor` across **213 tasks** (37% of corpus): 726 bare-but-unique, 178 ambiguous, 84 wrong-prefix, **244 genuinely external** |
| RC-3 | DD-09 requires a task's Gherkin titles to be a subset of its feature's, which is unsatisfiable for tasks whose AC sits at a finer altitude than the feature's ship contract | **619** `L4.uncovered-task-scenario` across **57 tasks** |
| RC-4 | Nothing obliges a warning to ever be reconciled, and the error ratchet covers only the active folder | **2,291** warnings accumulated; **404** errors across 180 `done` tasks sit outside the gate while `config/corpus-baseline.json` holds **2** entries |

RC-4 is why the other three grew unchecked: `corpus-check.ts` freezes its per-file sweep to the
active task folder — its own source comment names "404 findings in `docs/tasks{2,3}`" as known
deferred drift — and the ratchet is error-only, so warning-severity findings have no two-sided
reconciliation forcing anyone to act. Fixing RC-1/2/3 without RC-4 re-accumulates the same debt.

Operator ruling 2026-08-17: fix all four, **RC-4 first**; migrate historical anchors dry-run-first;
land the RC-1 content check as a warning and promote it to error only after the migration.
## Scope
**In:** `packages/app/src/services/corpus-check.ts` (sweep scope + warning ratchet),
`packages/app/src/services/task-check.ts` (anchor subject-matching, external-evidence notation),
`packages/domain/src/bdd/coverage.ts` (DD-09 altitude), `config/corpus-baseline.json` plus a
warning-side baseline, one new `spur task migrate` rule for anchor qualification, and the authoring
guidance that teaches the notations (`sp:code-verification`, `spur-dev/references/cross-cutting.md`,
`spur-dev/references/ac-style-guide.md`, `docs/04_DESIGN.md`).

**Out:** new CLI nouns or verbs — this feature adds one `task migrate` rule and changes existing
check semantics, nothing else (ADR-051 noun discipline). Re-authoring the 178 ambiguous bare-filename
anchors, which need an author's judgment, not a migration. Any change to the `--strict-core`
`testing → done` gate layers. Feature-side AC authoring conventions beyond the DD-09 altitude rule.
## Acceptance Criteria
```gherkin
Feature: Corpus gate integrity

  Scenario: R1 — The corpus sweep covers every configured task folder
    Given a structural error in a task outside the active folder
    When spur task check --corpus runs
    Then the error is observed by the sweep
    And it fails the gate unless it is in the accepted baseline

  Scenario: R2 — Warning-severity findings are ratcheted two-sided
    Given a warning baseline reconciled against the corpus
    When a new warning appears outside the baseline
    Then the gate fails naming it
    And a baseline entry that no longer reproduces also fails the gate

  Scenario: R3 — Evidence outside the repository has a legal citation form
    Given verification evidence that lives outside this repository
    When it is cited in the documented external-evidence form
    Then the checker records it as external rather than as a stale repo-root anchor
    And a repo-relative path is still required for evidence that lives in this repository

  Scenario: R4 — In-repo anchors are qualified by a reviewable migration
    Given a task citing a bare filename that resolves to exactly one repository path
    When the anchor-qualification migration runs with --dry-run
    Then the full old-to-new report is produced and no file is modified
    And applying it rewrites the citation to the repo-relative path

  Scenario: R5 — An anchor must name its requirement's subject
    Given an anchor whose line resolves but whose content does not name the cited requirement
    When spur task check runs
    Then the anchor is reported
    And the finding is a warning until the R4 migration has landed, an error after

  Scenario: R6 — A task declares its AC altitude instead of having one assumed
    Given a task whose acceptance criteria are finer-grained than its feature's ship contract
    When spur task check runs
    Then no uncovered-scenario finding is raised for that task
    And a task that does graduate its feature's scenarios is still held to the DD-09 subset rule
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0582 | Corpus ratchet: sweep every configured task folder and ratchet warning severity | wip |
| 0583 | Anchor integrity: qualification migration, then subject matching | todo |
| 0584 | Task authoring contract: external-evidence citation form and AC-altitude declaration | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-08-17T22:49:05.671Z moved L → F91 (system)
- 2026-08-18T00:10:12.783Z backlog → active (system)
