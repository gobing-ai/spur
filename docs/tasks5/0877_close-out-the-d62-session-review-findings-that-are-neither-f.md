---
schema_version: 1
name: Close out the D62 session-review findings that are neither fixed nor owned
status: todo
template: feature-impl
created_at: 2026-09-17T05:46:06.389Z
updated_at: "2026-09-17T06:45:32.696Z"
feature_id: D62

priority: P2
---

## 0877. Close out the D62 session-review findings that are neither fixed nor owned

### Background

Session review of the D62 batch (`dev-runall --feature D62`, 10 tasks 0866-0875, merged to `main` at `2ce696459`). The batch's ten pipelines each produced a review report; this task collects the findings that are neither owned by an existing task nor resolved inline by the review itself. It is a consolidation task, not a feature: every item below is a specific, evidenced defect or contract gap in work that already shipped.

Excluded, and why:
- 0871's R5 remainder (the pilot edge's first real-run routing decision) is owned by task **0876** — a deferred requirement recorded in its own task file, not a duplicate here.
- Four findings were fixed directly by the review, committed as `1c70da705`: the stale "no CLI consumer today" claim in `docs/design/workflow-execution-economy.md`, the census doc-comment "all 69" vs its 67 pin in `apps/cli/tests/json-envelope-inventory.test.ts`, the false "integration-review defect record was retired with it" clause in `docs/design/workflow-composition-contract.md`, and the stale "inside `spur-check`" note in `config/transition-shims.json`.
- 0868's pass-1 P2/P3s (the swallowed terminal closure, `--ok`/`--duration-ms` silent defaults, lost run-id attribution, blind `--close`) were repaired under operator direction and verified fixed by 0868's pass-2 review.
- Environmental findings stay notes, not work: the concurrent task-0902 rule re-installs that broke `test-pre-check` five times, the OpenCode weekly quota exhaustion, and the flash-tier executor timeouts are recorded in the batch report and the run's event trace.

### Requirements

- [ ] R1. The inline trace delegate behaves as one surface: `--action` reports an emission failure in a single stdout shape, accepts only the engine's finalize vocabulary (`done`/`failed`, not `running`/`paused`), and the two trace-failure recorders write the run log in one stamp format (0868 review findings 1, 3, 4 — persisted in 0868's ### Review).
- [ ] R2. An action row whose `node`/`kind` matches no declared state/action is surfaced as a `spur workflow progress` diagnostic instead of persisting invisibly, and a finalize for an action id the writer never observed keeps its run-id attribution (0868 review findings 2, 7 — persisted in 0868's ### Review).
- [ ] R3. The inline delegate's app-module surface is compile-time linked rather than hand-declared in a cast, so a signature change in `packages/app` fails the delegate's typecheck (0868 review finding 5; live anchor `plugins/sp/scripts/inline-run-setup.ts:262-278`).
- [ ] R4. ADR-117's `system_events` half for the inline surface — one start/finish pair per action boundary — is either delivered or explicitly recorded as out of scope against ADR-117 (0868 review finding 6).
- [ ] R5. The feature-scoped verification pass has a caller, so a feature whose `verifying→done` guard requires it can reach done without a hand-run command; the guard's declaration order is asserted and not only its kind set; and the pass's "settled tree" precondition is enforced or dropped from the contract (session-review findings about 0872, not persisted to its Review section; no-caller clause re-verified at refinement: `config/workflows/feature-lifecycle.yaml:71` reads the pass's status file and nothing invokes `feature-verification`).
- [ ] R6. The ADR-076 promotion gate decides on the measured real-run data it cites: a candidate with zero recorded runs cannot promote, the `resolve --decision promote` refusal branch is tested, `resolve` cannot contradict the evaluated verdict, and the duration statistic's `.runs` count matches its duration fold (session-review findings about 0873, not persisted to its Review section; every clause re-verified at refinement — anchors in Plan step 5).
- [ ] R7. The guard-parity harness enumerates state from the pre- and post-refactor commands' references, so a refactor that removes a reference cannot escape parity; and an over-declared (spurious) `dependencies[]` edge is caught rather than silently unbound from the planning digest (session-review findings about 0874/0875, not persisted to their Review sections; the second clause follows from 0875's shipped Option B — `dependencies` unbound from `computePlanningDigest` at `packages/app/src/services/task-readiness.ts:405`).
- [ ] R8. Agent-facing documentation stops advertising the retired `basic`/`docs-pipeline`/`feature-dev` definitions and their never-wired callers, and retiring a definition that still has real non-dry runs is refused by a check rather than only by a recorded verdict table (0866 review findings 5, 6 — persisted in 0866's ### Review; 7 plugin doc files still reference the retired names as of refinement).
- [ ] R9. The §Solution change maps and anchors of 0866, 0867 and 0868 are corrected — no `L4.anchor-subject-mismatch` warnings, and the 0866/0867 maps list every file their diffs changed (0866 findings 3-4, 0867 finding 1, 0868 finding 8 — persisted in those Review sections).

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R4 — Inline driver runs land in the structured action trace
    Given an inline-driver run whose action emission fails
    When the delegate reports the failure and the run reaches its terminal state
    Then the delegate reports that failure in one shape and one status vocabulary
    And every executed action still carries a trace row with a matching run id
    And the run log records the failure in one stamp format

  @edge
  Scenario: R12 — Trace emission failure never wedges or fails the run
    Given an action row whose node or kind matches no declared state
    When the operator reads the run's progress
    Then the mismatch is reported as a diagnostic rather than silently persisted
    And the run's own outcome is unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-17T06:45:31.996Z

- Q: R5/R6/R7 cite numbered findings from 0872-0875's reviews, but those Review sections hold only the pipeline SECU PASS tables. Why trust them? — A: Citation repair at refinement (2026-09-17): the findings lived only in the D62 session-review transcript. Every clause was independently re-verified against the live tree before this task was made ready — R5's no-caller claim (`feature-lifecycle.yaml:71` reads the status file, nothing invokes `feature-verification`), all of R6's clauses against `workflow-promotion.ts` (:284, :514-538, :263, :427, plus zero resolve-refusal tests), R7's second clause against 0875's shipped Option B (`task-readiness.ts:405`). The Plan's live anchors, not the original citations, are the acceptance bar; any clause that stops reproducing is closed not-reproducible per the Design rule.
- Q: Why was R6's "date comparison matches the sibling real-run-cost.ts method" clause dropped? — A: Not reproducible: `real-run-cost.ts` contains no date-comparison method (grep-verified at refinement), so the intended alignment target does not exist. `isPastDeadline`'s ISO string comparison (`workflow-promotion.ts:179`) is correct as written.
- Q: Why does R9 no longer name 0874? — A: 0874's Review contains no anchor/change-map finding and `spur task check 0874` reports zero findings today; naming it was a consolidation error.
- Q: Why no frontmatter `dependencies`? — A: Every task this one consolidates (0866-0875) is done, so the work is immediately runnable; adding done deps would be the over-declared-edge class R7 itself targets. 0876 appears in the Background as an exclusion note, not a prerequisite.
- Q: What is deferred? — A: R4's ADR-117 `system_events` half may legitimately resolve as a recorded out-of-scope decision rather than code; that is a decision this task must make explicitly, not silently skip.

### Design

Consolidation, not construction. Each requirement names defects already evidenced in a merged task's review report or re-verified against the live tree at refinement; the work is correction plus the missing guard, and every R-item has a reproduction or a live probe cited in its requirement or Plan step. Read the owning report before changing an item — the evidence there (exact command, observed output, `file:line`) is the acceptance bar, and an item whose evidence cannot be reproduced should be closed as not-reproducible rather than fixed blind. For R5/R6/R7 the originating findings were never persisted to 0872-0875's Review sections, so the live anchors in the Plan are the acceptance bar there (see Q&A).

Two placement rules apply. A condition a checker can own belongs in a checker (R5's caller, R6's promotion precondition, R7's harness enumeration, R9's anchor check) rather than in prose, per the repo's preference for machine-checked intent. A condition only this surface exhibits stays local to it (R1-R4 are all in the inline delegate and its writer).

Size: near the count-only precheck gate — 9 of 10 requirements (the Plan cap is 16 items; `plugins/sp/skills/spur-dev/references/execution-workflow.md:330`). If it grows past 10 requirements, decompose by module — the R-items are already grouped by owner (inline trace delegate / feature pass / promotion gate / harness + docs) and split cleanly along those seams.

### Plan

1. Reproduce each R-item's evidence before touching code: R1-R4 from 0868's ### Review (pass 2, findings 1-7), R8/R9 from 0866's (findings 3-6) and 0867's (finding 1) ### Review sections, R5/R6/R7 from the live anchors below (their session-review findings were never persisted to 0872-0875's Review sections). Drop any item that no longer reproduces, recording the command that showed it.
2. R1-R3 (inline trace delegate, `plugins/sp/scripts/inline-run-setup.ts`): unify the failure shape, restrict `--status` to the finalize vocabulary (`ACTION_STATUSES`/`CLOSE_STATUSES` at :201-204), unify the log stamp format, add the undeclared-node diagnostic, restore run-id attribution on an unobserved start, and replace the hand-declared cast (:262-278) with a compile-time link.
3. R4 decision: deliver the `system_events` start/finish pair, or record the inline surface's scope against ADR-117 with the reason.
4. R5: give the feature-scoped pass a caller at the feature boundary (today `config/workflows/feature-lifecycle.yaml:71` reads `.spur/run/<featureId>-feature-verification.status` but nothing runs `feature-verification`), assert the guard's declaration order, and enforce or drop the settled-tree precondition.
5. R6 (`scripts/commands/workflow-promotion.ts`): `evaluateCandidate` decides `promote` even with zero measured runs (:284 — gate the decision on `measured.agentRunCount.runs > 0`); add the missing `resolve --decision promote` refusal test; make `resolve` refuse a decision contradicting `candidate.verdict` (:514-538 never reads it); fix the duration fold's `.runs` (:263 folds `rows.length` over a null-filtered durations array); wire or drop `--now` in the resolve branch (:427 parses it, the branch never uses it).
6. R7: widen `plugins/sp/scripts/inline-pipeline-parity-check.ts` to enumerate state from the pre-refactor reference set as well, and add the over-declared `dependencies[]` check (post-0875, dependency edges no longer move the planning digest — `task-readiness.ts:405`).
7. R8: sweep the agent-facing docs that still advertise the retired definitions (`plugins/sp/README.md`, `plugins/sp/skills/spur-dev/references/gate-checklists.md` + `cross-cutting.md`, `plugins/sp/skills/spur-cli/references/workflows*.md` — 7 files at refinement), and add the retirement refusal check for definitions with real non-dry runs.
8. R9: correct the three tasks' §Solution change maps and anchors (0866: add the omitted 25th file `.github/workflows/publish.yml:64`; 0867: complete the 8-of-10 map; 0866/0868: fix the anchor subjects).
9. Run `bun run spur-check` and `bun run spur-check-feature`; both green.
10. Record the outcome per R-item in this task's §Testing, including any item closed as not-reproducible.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: D62 (`docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md`)
- Persisted review reports: 0866 (pass 2, findings 3-6), 0867 (finding 1), 0868 (pass 2, findings 1-8) — in those tasks' ### Review sections
- Owning tasks for the transcript-only findings: 0872, 0873, 0874, 0875
- Batch evidence: `.spur/run/worktree-runall-d62-750cc-89fdd4.json` (156 artifacts persisted), merge commit `2ce696459`, inline review fixes `1c70da705`
- Task 0876 — owns 0871's R5 remainder (excluded from this task)
- ADR-076 (promotion evidence), ADR-117 (inline trace emission), ADR-118 (contract-first routing), ADR-119 (validation scope split)
- `docs/design/workflow-execution-economy.md`
- Precheck size gate: `plugins/sp/skills/spur-dev/references/execution-workflow.md:330` (>10 requirements or >16 Plan items → FAIL)

### History

- 2026-09-17T06:45:32.696Z backlog → todo (system)

