---
schema_version: 1
name: Close out the D62 session-review findings that are neither fixed nor owned
status: backlog
template: feature-impl
created_at: 2026-09-17T05:46:06.389Z
updated_at: "2026-09-17T05:46:45.741Z"
feature_id: D62

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

- [ ] R1. The inline trace delegate behaves as one surface: `--action` reports an emission failure in a single stdout shape, accepts only the engine's finalize vocabulary (`done`/`failed`, not `running`/`paused`), and the two trace-failure recorders write the run log in one stamp format (0868 findings 1, 3, 4).
- [ ] R2. An action row whose `node`/`kind` matches no declared state/action is surfaced as a `spur workflow progress` diagnostic instead of persisting invisibly, and a finalize for an action id the writer never observed keeps its run-id attribution (0868 findings 2, 7).
- [ ] R3. The inline delegate's app-module surface is compile-time linked rather than hand-declared in a cast, so a signature change in `packages/app` fails the delegate's typecheck (0868 finding 5).
- [ ] R4. ADR-117's `system_events` half for the inline surface — one start/finish pair per action boundary — is either delivered or explicitly recorded as out of scope against ADR-117 (0868 finding 6).
- [ ] R5. The feature-scoped verification pass has a caller, so a feature whose `verifying→done` guard requires it can reach done without a hand-run command; the guard's declaration order is asserted and not only its kind set; and the pass's "settled tree" precondition is enforced or dropped from the contract (0872 P2, P3, P4).
- [ ] R6. The ADR-076 promotion gate decides on the measured real-run data it cites: a candidate with zero recorded runs cannot promote, the `resolve --decision promote` refusal branch is tested, `resolve` cannot contradict the evaluated verdict, its `.runs` statistic matches its duration fold, `--now` is wired or removed, and its date comparison matches the sibling `real-run-cost.ts` method (0873 findings 1-4, 6).
- [ ] R7. The guard-parity harness enumerates state from the pre- and post-refactor commands' references, so a refactor that removes a reference cannot escape parity; and an over-declared (spurious) `dependencies[]` edge is caught rather than silently unbound from the planning digest (0874 P4; 0875 P4).
- [ ] R8. Agent-facing documentation stops advertising the retired `basic`/`docs-pipeline`/`feature-dev` definitions and their never-wired callers, and retiring a definition that still has real non-dry runs is refused by a check rather than only by a recorded verdict table (0866 P3, P4).
- [ ] R9. The §Solution change maps and anchors of 0866, 0867, 0868 and 0874 name their subjects — no `L4.anchor-subject-mismatch` warnings — and 0866's map lists every file its diff changed (0866 P3 x2, 0867 P3, 0868 P4; the recurring warning class).

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

### Design

Consolidation, not construction. Each requirement names defects already evidenced in a merged task's review report; the work is correction plus the missing guard, and every R-item already has a reproduction or a live probe in its originating report. Read the owning report before changing an item — the evidence there (exact command, observed output, `file:line`) is the acceptance bar, and an item whose evidence cannot be reproduced should be closed as not-reproducible rather than fixed blind.

Two placement rules apply. A condition a checker can own belongs in a checker (R5's caller, R6's promotion precondition, R7's harness enumeration, R9's anchor check) rather than in prose, per the repo's preference for machine-checked intent. A condition only this surface exhibits stays local to it (R1-R4 are all in the inline delegate and its writer).

Size: this task is at the repo's precheck cap (9 R-items / 10 Plan items). If it grows past 10 requirements when refined, decompose by module — the R-items are already grouped by owner (inline trace delegate / feature pass / promotion gate / harness + docs) and split cleanly along those seams.

### Plan

1. Reproduce each R-item's evidence from its originating review report; drop any item that no longer reproduces, with the command that showed it.
2. R1-R4 (inline trace delegate): unify the failure shape, the status vocabulary and the log stamp format; add the undeclared-node diagnostic; restore run-id attribution on an unobserved start; link the delegate's app surface by type.
3. R4 decision: deliver the `system_events` pair, or record the inline surface's scope against ADR-117 with the reason.
4. R5: give the feature-scoped pass a caller at the feature boundary, assert the guard's declaration order, and resolve the settled-tree precondition.
5. R6: make the promotion decision require measured history, cover the refusal branch, honour the evaluated verdict, and correct the statistic, the dead flag and the date comparison.
6. R7: widen the parity harness to the pre-refactor reference set, and add the over-declared `dependencies[]` check.
7. R8: sweep the agent-facing docs that still advertise the retired definitions.
8. R9: correct the four tasks' §Solution change maps and anchors.
9. Run `bun run spur-check` and `bun run spur-check-feature`; both green.
10. Record the outcome per R-item in this task's §Testing, including any item closed as not-reproducible.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
