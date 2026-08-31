---
schema_version: 1
id: "F91"
name: "Corpus gate integrity: content-verified evidence anchors, external-evidence notation, AC-altitude carve-out, and a two-sided warning ratchet"
status: verifying
priority: P2
tags: []
created_at: "2026-08-17T22:15:08.187Z"
updated_at: "2026-08-31T02:07:20.914Z"
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
    And the finding stays a warning while historical drift is merely baselined
    And it is promoted to error only once that drift is repaired, not accepted

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
| 0582 | Corpus ratchet: sweep every configured task folder and ratchet warning severity | done |
| 0583 | Anchor integrity: qualification migration, then subject matching | done |
| 0584 | Task authoring contract: external-evidence citation form and AC-altitude declaration | done |
| 0625 | Close the 2026-08-21 dogfood residue: lifecycle projections and gates that report a state the tree contradicts | done |
| 0688 | Right-size the post-implementation task gate: drop no-signal citation checks, keep real drift detection | done |
| 0714 | Post-F95 corpus drift reconciliation: re-point shifted anchors, fix matcher false positives, baseline verdict-rows findings | done |
| 0721 | Fail closed on hollow MET verdict evidence in task-verdict derivation | done |
<!-- END AUTO-GENERATED -->

## Notes

**Reopened 2026-08-27 — slice 2: the matcher decision ADR-083 routed here.**

RC-1 through RC-4 shipped and remain shipped; this reopen does not reverse them. The feature is
active again because it owns the anchor subject-matcher, and ADR-083 (2026-08-25, task 0670,
feature F61) measured that matcher and **routed a proposal to F91 without applying it** — F61 put
matcher changes out of scope. F91 closed on 2026-08-21, four days before that routing, so the
proposal arrived at a terminal feature and no task carried it.

What the routed proposal says, in ADR-083's own measurements:

- **Probe 2 (the driver):** the matcher reads only the cited lines, so a single-line anchor pointing
  inside a symbol can never contain that symbol's name — *"The citation is correct and the window is
  too narrow."* Widening the cited window to ±20 lines moves new mismatches **42 → 10** and turns
  ~101 baselined entries stale.
- **Probe 1:** `extractSubjectTokens` excludes only the anchor under test, so a sibling anchor's path
  becomes an unmatchable subject token (~0.5% of the class).
- **Probe 3:** the 5-findings-per-section cap couples per-code counts, so deltas are only comparable
  when cap engagement is stated.

Consequence that forced the reopen: `.spur/config.yaml`'s `tasks.severity` block still carries
`L4.anchor-subject-mismatch: error` from task 0583 R6 (2026-08-18) — a promotion whose premise
ADR-083 reversed a week later. On 2026-08-27 it blocked task 0687's `wip → testing` transition on a
citation that was correct (`apps/cli/src/commands/agent.ts:425`), which is the encounter that
surfaced the orphaned proposal.

**Slice-2 scope:** task **0688** only — apply probes 1 and 2, re-decide the severity override,
retire the `L3.testing-coverage` human obligation that duplicates `bunfig.toml`'s enforced 90/90
threshold, and add `L3.status-claim-contradiction`. Explicitly **not** in scope: a citation-repair
campaign (ADR-083 chose against it), collapsing `L4.stale-line-anchor` or `L3.solution-file-line`
(different, true facts), and a broad audit of the other 48 finding codes.

**Known warning class while slice 2 is open:** task 0688's twelve AC scenarios report
`L4.uncovered-task-scenario` because they sit below this feature's ship-contract altitude. That is
RC-3 — this feature's own diagnosis — and the AC-altitude carve-out covers it. Warnings only; the
feature and task gates both pass. Add a slice-2 scenario to `## Acceptance Criteria` if the
carve-out is later judged insufficient.

## History

- 2026-08-17T22:49:05.671Z moved L → F91 (system)
- 2026-08-18T00:10:12.783Z backlog → active (system)
- 2026-08-18T06:21:22.420Z active → verifying (system)
- 2026-08-18T06:24:28.631Z verifying → active (system)
- 2026-08-21T23:23:08.778Z active → verifying (system)
- 2026-08-21T23:26:42.870Z verifying → done (system)
- 2026-08-27T15:33:31.671Z done → active (system)
- 2026-08-27T19:00:52.678Z active → verifying (system)
- 2026-08-27T19:00:53.092Z verifying → done (system)
- 2026-08-29T06:17:19.126Z done → active (system)
- 2026-08-31T02:07:20.914Z active → verifying (system)
