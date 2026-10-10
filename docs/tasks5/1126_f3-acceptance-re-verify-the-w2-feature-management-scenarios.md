---
schema_version: 1
name: "F3 acceptance: re-verify the W2 feature-management scenarios"
status: done
template: feature-impl
created_at: 2026-10-08T17:39:23.987Z
updated_at: "2026-10-09T21:30:40.535Z"
feature_id: F3

done_forced: "true"
done_reason: "Inline acceptance re-verify (operator-chosen F3 closure); verdict PASS HIGH from .spur/memory/evidence/1126-verdict.json, no pipeline run"
---

## 1126. F3 acceptance: re-verify the W2 feature-management scenarios

### Background

F3 (Feature management CLI) was implemented by legacy W2 tasks 0056/0057/0058/0061. Their frontmatter predates
the A17 schema (`feature-id:`, no `schema_version`), so the CLI cannot link them and `spur feature check F3`
reported all four F3 scenarios as uncovered. This task re-verifies each scenario against the current code with
fresh evidence, so F3 has a linked, verified owner per scenario without a 127-file legacy migration.

### Requirements

- [x] R1. Hierarchical ID allocation: a child create under a parent with N children allocates digit N+1 (file `<id>_<slug>.md`); a parentless create allocates the next free group letter.
- [x] R2. One active P0 goal: `spur feature check` reports a second P0 feature entering `active` while another P0 is active.
- [x] R3. INDEX tree: `spur feature refresh` renders INDEX.md as an ID-encoded tree with per-node status and links across three depths, and never modifies task files.
- [x] R4. Moves cascade: `spur feature move` renames the subtree consistently and updates every linked task `feature_id` edge with a History entry on each touched task.
- [x] R5. F3's Scope delineates in-scope and out-of-scope items.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Hierarchical ID allocation
  Given group A has children A1 and A2
  When spur feature create "X" --parent A runs
  Then the new feature is A3 in docs/features/A3_x.md
  And creating with no parent allocates the next free group letter

Scenario: AC2 — One active P0 goal
  Given an active P0 feature exists
  When a second P0 feature transitions to active
  Then spur feature check reports the violation

Scenario: AC3 — INDEX renders the ID-encoded tree
  Given features at three depths
  When spur feature refresh runs
  Then INDEX.md shows a tree view with per-node status and links
  And task files are never modified

Scenario: AC4 — Moves cascade
  Given feature A1 with children and linked tasks
  When spur feature move A1 --parent B runs
  Then descendants are renamed consistently
  And every task feature_id edge is updated with History entries
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: one acceptance task owns the four F3 scenarios, verified against current tests; rejected migrating
  `docs/tasks` (127-file normalization, unrelated diff) and hand-editing legacy frontmatter (CLI-gated corpus).
- Gap found while mapping AC4: `FeatureService.move` rewrote task `feature_id` but appended no task History line,
  contrary to its own contract (DD-14). Fix: reuse `appendFeatureHistory` in the task-edge loop.
- AC1 had no exact assertion for "A3 file" + "next free letter"; add one focused service test.
- R5: rewrite F3 Scope as `- In:` / `- Out:` bullets via `spur feature update --section Scope`.

### Plan

- [x] Map each F3 scenario to existing tests; identify uncovered clauses.
- [x] Failing test, then fix: task History on move edge rewrite.
- [x] Pin AC1 allocation with an exact service test.
- [x] Rewrite F3 Scope (In/Out).
- [x] Run focused suites, lint, typecheck; verify; record.

### Solution

| File | Change |
| --- | --- |
| `packages/app/src/services/feature-service.ts:989` | move's task-edge loop calls appendFeatureHistory, so each moved task's History gains a feature_id line (DD-14) |
| `packages/app/src/services/feature-service.ts:1266-1270` | appendFeatureHistory now documented for a feature or task doc |
| `packages/app/tests/services/feature-service.test.ts:315` | AC1: A, A1, A2 → `--parent A` allocates A3 (`A3_x.md`); parentless create allocates B |
| `packages/app/tests/services/feature-service.test.ts:698` | AC4: moved task carries the History line |
| `docs/features/F3_feature-management-cli.md` | Scope rewritten as In/Out bullets (via `spur feature update`) |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/feature-service.ts:1113-1115` parentless create returns the first unused group letter; test `packages/app/tests/services/feature-service.test.ts:315` (A, A1, A2 → --parent A allocates A3 as A3_x.md; parentless allocates B); fresh 2026-10-08 feature-service 59 pass / 0 fail |
| R2 | MET | test `packages/app/tests/services/feature-check.test.ts:877` a P0 entering active while another P0 is active yields one error-severity one-active-goal finding and pass false (`packages/app/tests/services/feature-check.test.ts:919-921`); fresh feature-check suite pass |
| R3 | MET | tests `packages/app/tests/services/feature-service.test.ts:485` (ID-encoded tree, status badge, relative links), `packages/app/tests/services/feature-service.test.ts:534` (task files byte-identical after refresh), `packages/app/tests/services/feature-service.test.ts:586` (real corpus copy: 71 depth-3 features rendered) |
| R4 | MET | FIXED this run: `packages/app/src/services/feature-service.ts:989` appends the feature_id History line on each moved task; tests `packages/app/tests/services/feature-service.test.ts:691` + `packages/app/tests/services/feature-service.test.ts:698` (edge B1 + History line; failed before the fix this run) |
| R5 | MET | `docs/features/F3_feature-management-cli.md:21-23` Scope now has In/Out bullets; `spur feature check F3` no longer emits L3.scope-delineation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Hierarchical ID allocation | MET | test | `packages/app/tests/services/feature-service.test.ts:315` A3 allocated as A3_x.md under A with A1/A2; parentless create allocates B; fresh run 59 pass / 0 fail |
| AC2 — One active P0 goal | MET | test | `packages/app/tests/services/feature-check.test.ts:877` second P0 entering active is reported (`packages/app/tests/services/feature-check.test.ts:919-921`); fresh run pass |
| AC3 — INDEX renders the ID-encoded tree | MET | test | `packages/app/tests/services/feature-service.test.ts:485` tree with per-node status and links; `packages/app/tests/services/feature-service.test.ts:534` task files never modified; `packages/app/tests/services/feature-service.test.ts:586` three-depth real corpus |
| AC4 — Moves cascade | MET | test | `packages/app/tests/services/feature-service.test.ts:671` subtree renamed A1→B1, A11→B11; `packages/app/tests/services/feature-service.test.ts:691` every task edge updated with a History entry (`packages/app/tests/services/feature-service.test.ts:698`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-08T17:40:25.602Z backlog → todo (system)
- 2026-10-08T17:40:28.964Z todo → wip (system)
- 2026-10-08T17:45:16.973Z wip → testing (system)
- 2026-10-08T17:45:37.405Z testing → done (system)

