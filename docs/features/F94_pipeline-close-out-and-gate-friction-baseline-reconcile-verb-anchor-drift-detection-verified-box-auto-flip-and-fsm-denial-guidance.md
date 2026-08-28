---
schema_version: 1
id: "F94"
name: "Pipeline close-out and gate friction: baseline reconcile verb, anchor-drift detection, verified-box auto-flip, and FSM denial guidance"
status: verifying
priority: P1
tags: []
created_at: "2026-08-27T19:43:44.288Z"
updated_at: "2026-08-28T03:19:46.863Z"
---

# F94: Pipeline close-out and gate friction: baseline reconcile verb, anchor-drift detection, verified-box auto-flip, and FSM denial guidance

## Goal

Close the confirmed frictions from the task-0688 post-run friction review (session 2026-08-27,
commits f7402c21 / f60e5aec1), consolidated per operator review (2026-08-27) from twelve
over-decomposed tasks into three work streams:

| Stream | Absorbs | Evidence from the 0688 run |
| --- | --- | --- |
| Close-out integrity | G-2, G-3, G-4 + `resolveRepoRoot` rider | 0606's `eval-pipeline.ts:528` drifted to `:562` after 0688's +34 lines (caught only post-commit); **21** unchecked boxes in done task 0688 forced post-close flips (history rewrite); `feature update F91 done` denied with no legal-path hint; `resolveRepoRoot` cwd bug verified via stash |
| Gate & baseline simplification | G-1 + all of F96 | Reconciling `config/corpus-baseline.json` is hand-rolled jq — an inverted filter silently dropped it **1907 → 18**, caught only by a 408-new-error blowup; baseline now ~1928 dated entries; the operator ruled the dated-baseline machinery itself the wrong direction (2026-08-27): simplify massively. F96's claim-matcher subject association folds in — simplification may delete the clause-window machinery rather than refine it (dated residue 0607/0677/0670) |
| Docs consolidation | symbol-anchor + sweep-once riders | `path:line` citations rot (G-2's root cause); 17 `--corpus` sweeps × ~60s ≈ 17 min burned in one session |

Operator direction (2026-08-27): the ADR-088 two-sided dated-baseline direction is wrong —
simplify the corpus gate and `config/corpus-baseline.json` for reliability and efficiency. The
simplification task is design-first: an ADR in `docs/00_ADR.md` evaluates simplification options,
and operator approval gates implementation (that approval message is the ADR-051 consent evidence
for any `task check` surface change).

## Scope

**In (one task per stream):**

- **Close-out integrity** — anchor-drift re-resolution inside `task check`, reported at
  commit-prep; Requirements/AC checkbox auto-flip in the `task record`/verify path when the
  verdict marks them MET/PASS; `GuardDeniedError` message enrichment naming legal paths and the
  commands that reach them (both FSMs); the `resolveRepoRoot` cwd-dependence fix. One
  implementation surface (packages/app task/feature services), one test pass.
- **Gate & baseline simplification** — design-first: an ADR entry in `docs/00_ADR.md` evaluating
  simplification options (e.g. drop dated-residue baselining and gate only
  new-findings-vs-committed-snapshot; collapse superseded finding classes; single-sided vs
  two-sided tradeoffs), then implementation of the approved option. Absorbs F96: claim-matcher
  subject association is evaluated inside this ADR — simplification may delete the clause-window
  machinery rather than refine it.
- **Docs consolidation** — the symbol-anchor citation convention (`path:symbol` over `path:line`)
  and the sweep-once discipline (iterate with single-task check; run `--corpus` once before
  commit), landed in `docs/04_DESIGN.md` + verification-gate docs in one pass. Depends on the
  simplification ADR outcome for the gate docs.

**Out:** a reconcile verb or any entrenchment of the dated-baseline machinery (operator ruled the
complexity the wrong direction, 2026-08-27); the CLI JSON envelope (F95); any simplification
implementation before the ADR decision is approved; re-decomposition into subtasks (operator
merged the twelve tasks into these streams on purpose).

## Acceptance Criteria

```gherkin
Feature: Pipeline close-out and gate friction

  Scenario: R1 — Gate & baseline simplification is design-first with an operator approval gate
    Given the dated-baseline machinery (config/corpus-baseline.json, ~1928 entries) and its reconcile churn
    When the simplification ADR is authored in docs/00_ADR.md
    Then it evaluates simplification options — e.g. drop dated-residue baselining and gate only new-findings-vs-committed-snapshot, collapse superseded finding classes, single-sided vs two-sided tradeoffs
    And implementation waits for operator approval of the chosen option (ADR-051 consent evidence, 2026-08-27)
    And the approved option is then implemented, including the disposition of the F96 claim-matcher clause-window machinery

  Scenario: R2 — Line-number anchor drift is caught at commit-prep, not post-commit
    Given a done task citing `path:line` anchors and a source edit that moved those lines
    When `task check` re-resolves the anchors against the current tree
    Then the drift is reported as a finding or a report section

  Scenario: R3 — A verdict that marks a requirement MET/PASS leaves its boxes checked
    Given a verify verdict whose requirement verdicts mark Requirements and AC boxes MET/PASS
    When `task record`/verify writes the task record
    Then the corresponding checklist boxes are flipped to checked
    And no post-close manual flips or history rewrite are needed

  Scenario: R4 — A denied transition names the legal path
    Given a lifecycle transition the FSM denies
    When the denial is raised
    Then the `GuardDeniedError` message names the legal path(s) or the command that reaches them

  Scenario: R5 — New citations prefer symbols over line numbers
    Given the symbol-anchor convention documentation and corpus note
    When new task citations or test evidence are authored
    Then `path:symbol` is the preferred form over `path:line`

  Scenario: R6 — The corpus sweep runs once per commit
    Given the sweep-once discipline codified in the verification-gate docs
    When an agent iterates on a task
    Then single-task check drives the loop and `task check --corpus` runs once before commit

  Scenario: R7 — Repo-root resolution does not depend on cwd
    Given `resolveRepoRoot` invoked from a nested working directory
    When the repo root is resolved
    Then the same root is found regardless of the invoking cwd
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0691 | Corpus gate & baseline simplification: design-first ADR and operator-gated implementation | done |
| 0692 | Close-out integrity: anchor-drift detection, verified-box auto-flip, FSM denial guidance, resolveRepoRoot fix | done |
| 0694 | Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-28T01:01:06.233Z backlog → active (system)
- 2026-08-28T03:19:46.863Z active → verifying (system)
