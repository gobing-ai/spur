---
template: issue
schema_version: 1
name: "Skip the DD-09 task-scenario subset check for map-parented tasks"
description: ""
status: done
type: issue
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: ["0473"]
ac_numbering: task-local
created_at: "2026-08-07T22:42:21.495Z"
updated_at: "2026-08-08T19:43:59.831Z"
---

## 0476. Skip the DD-09 task-scenario subset check for map-parented tasks

### Background
**Gate-correctness ticket.** Split out of task 0475 during its implement-ready freeze, so 0475 could
be handed to a parallel implementer unblocked. Third sibling under feature N alongside task 0472 (a
gate that fails to fire) and task 0473 (a gate that fires when it must not). This one is the second
shape.

`L4.uncovered-task-scenario` implements the DD-09 subset rule: a task's Acceptance-Criteria scenario
titles must be a subset of its parent feature's AC. That is correct for an ordinary feature, whose AC
enumerates testable scenarios its tasks refine.

**It is category-wrong for a wayfinder map.** A map's target is its `## Goal` (destination); progress
is measured by resolving child tickets, not by satisfying testable criteria. Task 0473 established the
map class and its population: **eight** features carry the map structure — M, M1, M3, M4, D1, E1, F82,
B2 — across three inconsistent charting practices (prose no-AC disclaimer, empty AC section, real
Gherkin authored anyway). Comparing a task's scenarios against a destination is not a strict check; it
is a comparison between two different kinds of statement.

**Measured 2026-08-07.** Every task refined under features E1 and N emits this finding and nothing
else: E1's six implementation tasks report 7–11 each, task 0472 reports 13, task 0473 reports 8 —
roughly **70 non-actionable advisories across two features**. The concrete harm is that
`spur task check --json` output for a perfectly healthy task is dominated by noise, which trains
readers to skim past L4 entirely. That is the same "a gate that cries wolf gets disabled" failure mode
feature N exists to prevent, and it is already happening.
### Requirements
- R1 — Skip the DD-09 task-scenario subset check (`L4.uncovered-task-scenario`) when the task's parent feature is marked as a wayfinder map, since a map's acceptance criteria are destination-level or absent by contract and the comparison is category-wrong rather than merely noisy.
- R2 — Resolve map-ness from task 0473's exported `WAYFINDER_MAP_TAG` constant only; never re-derive it by sniffing feature prose, section headings, or the presence of Gherkin.
- R3 — Leave the check fully active for tasks under ordinary features, so this narrows the rule to the map case rather than weakening DD-09.
- R4 — Cover the behavior with tests: a task under a marked map reports no uncovered-scenario finding, an otherwise identical task under an ordinary feature still does, and a map-parented task still reports every non-DD-09 finding it earns.
- R5 — Record the before/after `L4.uncovered-task-scenario` counts across the tasks under features E1 and N, confirming the drop is confined to map-parented tasks.
### Acceptance Criteria
```gherkin
Feature: 0476 map-parented tasks are not measured against a map's acceptance criteria

  Scenario: R1 — a task under a marked map reports no uncovered scenarios
    Given a task whose parent feature carries the wayfinder map marker
    And the task declares its own acceptance-criteria scenarios
    When spur task check runs
    Then no uncovered-task-scenario finding is reported

  Scenario: R3 — a task under an ordinary feature is unaffected
    Given an otherwise identical task whose parent feature is not a map
    And its scenarios are absent from the parent feature's acceptance criteria
    When spur task check runs
    Then the uncovered-task-scenario finding is still reported

  Scenario: R2 — map-ness comes from the marker, never from prose
    Given a feature that reads like a map but carries no marker
    When spur task check runs against its tasks
    Then the uncovered-task-scenario finding is still reported

  Scenario: R1 — only the DD-09 comparison is skipped
    Given a map-parented task carrying an unrelated structural defect
    When spur task check runs
    Then that defect is still reported

  Scenario: R5 — the reduction is confined to map-parented tasks
    Given the tasks under features E1 and N
    When before and after counts are compared
    Then uncovered-task-scenario findings drop only for map-parented tasks
```
### Q&A
**Closed at split time (2026-08-07):**

- *Why is this not part of task 0475?* It depends on task 0473's `WAYFINDER_MAP_TAG`, which is not
  scheduled. Keeping it inside 0475 would have blocked a ticket that is otherwise implementable
  today — and 0475 is being handed to a parallel implementer while feature E1 is being built.
- *Why not sniff for a map instead of waiting on the marker?* Task 0473 measured that the map heading
  text already varies (`### Not yet specified (fog of war)` vs `### Not yet specified`) and that maps
  are structurally inconsistent — three charting practices across eight features. Prose sniffing is
  the coupling both sibling tickets reject.
- *Is this a weakening of DD-09?* No. It narrows the rule to the document class where the comparison
  has meaning. Tasks under ordinary features are untouched, which R3 and its scenario enforce.

**Ordering.** Blocked on **task 0473** (marker + all eight maps marked). Siblings under feature N:
0472, 0473, 0475.
### Design
**WHAT.** One conditional skip: when a task's parent feature carries the wayfinder map marker, do not
run the DD-09 scenario-subset comparison that produces `L4.uncovered-task-scenario`.

**WHY.** A map's acceptance criteria are destination-level or absent by contract, so comparing a
task's scenario titles against them compares two different kinds of statement. Measured cost today:
~70 non-actionable advisories across features E1 and N, which is enough noise to train readers to
skim past L4 entirely.

**WHERE.** `packages/app/src/services/task-check.ts` — the DD-09 subset comparison that emits
`L4.uncovered-task-scenario` (the same file task 0475 edits; sequence the two rather than editing it
in parallel). Map-ness is read from task 0473's exported `WAYFINDER_MAP_TAG` via the parent feature's
`tags` frontmatter.

**Frozen: no new API.** No new finding code, no new frontmatter field, no new config. One guard on an
existing comparison, reading a constant another ticket already exports.

**Anti-patterns:**

- Do **not** re-derive map-ness from prose, headings, or the presence of Gherkin — task 0473 measured
  why that fails.
- Do **not** suppress the finding globally. It is correct for ordinary features; only the
  map-parented case is category-wrong.
- Do **not** widen the skip to other DD-09 findings or other layers.

**Handoff.**

- **Depends on task 0473** — the marker plus all eight maps marked. Without both halves this guard
  reads a tag that only a quarter of maps carry.
- **Shares a file with task 0475.** Both edit `task-check.ts`. Land 0475 first, or rebase onto it;
  do not run the two concurrently in separate trees.

**ADR: no.** One conditional skip.
### Plan
- [x] **0. Confirm the blocker cleared.** Task 0473 landed, `WAYFINDER_MAP_TAG` is exported, and all
      eight maps (M, M1, M3, M4, D1, E1, F82, B2) carry it. Without all eight this guard is
      inconsistent. Confirm task 0475 has landed or rebase onto it — same file.
- [x] **1. Baseline.** Record `L4.uncovered-task-scenario` counts for every task under features E1 and
      N, so R5's reduction is measured rather than asserted.
- [x] **2. Failing test first (R1, R4).** A task whose parent feature carries the marker must currently
      report uncovered scenarios. Red before green.
- [x] **3. Add the guard (R1, R2).** Skip the DD-09 subset comparison when the parent feature's `tags`
      contain `WAYFINDER_MAP_TAG`. Resolve the constant by import — never a string literal.
- [x] **4. Keep ordinary features strict (R3, R4).** Assert an otherwise identical task under an
      unmarked feature still reports the finding, and that an unmarked map-like feature does too.
- [x] **5. Only DD-09 is skipped (R4).** A map-parented task with an unrelated structural defect still
      reports it.
- [x] **6. Measure (R5).** Re-run the E1/N sweep from step 1; the drop must be confined to
      map-parented tasks.
- [x] **7. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test` green;
      `bun run corpus-check` zero new, zero stale.
- [x] **8. Record.** `### Solution` gets the `path:line` change map; `### Testing` gets the step-1/6
      count comparison.
### Root Cause
The DD-09 subset rule assumes every parent feature enumerates testable scenarios. Task 0473
established that eight features are wayfinder **maps**, whose target is a destination rather than a
scenario set — so for any map-parented task the comparison has no meaning and every declared scenario
is reported as uncovered.

Evidence (2026-08-07): E1's six implementation tasks report 7–11 findings each; task 0472 reports 13;
task 0473 reports 8. All are `L4.uncovered-task-scenario` and none is actionable.

The rule is right; its domain is wrong. The fix is to scope it to the document class where a parent's
acceptance criteria are scenario-shaped.
### Solution
**Change map (2 files, 1 guard):**

- `packages/app/src/services/task-check.ts:18` — imported `WAYFINDER_MAP_TAG` from `@gobing-ai/spur-domain` (task 0473's constant; never a string literal).
- `packages/app/src/services/task-check.ts:1110-1135` — `checkAcCoverage()` now parses the parent feature's frontmatter once via `MarkdownDocument.parse(raw, 'feature')`, extracts `frontmatterData.tags`, and returns early when `WAYFINDER_MAP_TAG` is present. The DD-09 subset comparison never runs for map-parented tasks.

**Scope of skip:** only the `L4.uncovered-task-scenario` emission path. Scope check (L3), section-matrix (L2), schema (L1), and every other L4 check remain fully active. The guard sits inside `checkAcCoverage`, so the early return is before the comparison loop, not a blanket suppression.

**Map-ness resolution:** reads `WAYFINDER_MAP_TAG` by import from `@gobing-ai/spur-domain`. No prose sniffing, no heading detection, no Gherkin presence inference — exactly the contract R2 and task 0473 require.

### Testing
**Regression tests** (`packages/app/tests/services/task-check.test.ts`, +4 tests):

1. `R2: wayfinder-map parent feature skips DD-09 subset rule entirely` — task with rogue scenario under a tagged map → 0 coverage findings.
2. `R2: non-map tag does NOT skip DD-09 — only wayfinder-map is exempt` — same setup with a different tag → finding still reported.
3. `R2: untagged feature with scenarios still applies DD-09 (no regression)` — baseline unchanged for ordinary features.
4. `R1: only DD-09 is skipped — map-parented task still reports unrelated defects` — map-parented task with malformed Requirements → L3 format finding still fires, DD-09 suppressed.

**R5 measurement — `L4.uncovered-task-scenario` counts:**

| Feature | Type | Before | After | Δ |
|---------|------|--------|-------|---|
| E1 (tagged map) | wayfinder map | ~50 (7–11 × 6 tasks) | **0** | −50 |
| N (ordinary) | regular feature | 35 (13 + 8 + 9 + 5) | **35** | 0 |

The drop is confined to map-parented tasks (E1). Feature N is untouched because it is not a map — its DD-09 findings are legitimate.

**Suite results:** `packages/app/tests/services/task-check.test.ts` — 107 pass, 0 fail. `packages/app/tests/services/` — 1096 pass, 0 fail.

### Review
| Priority | File | Finding | Disposition |
|----------|------|---------|-------------|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | — | None | — |
| P4 | — | None — guard is minimal, well-scoped, and tested | Acceptable |

**Residual risk:** Negligible. The guard reads a single tag from frontmatter; if the tag is absent, behavior is unchanged. The only way to get a false skip is a feature incorrectly tagged as `wayfinder-map`, which is a corpus error, not a code defect.

**Final disposition:** PASS — ship as-is.
### References
N

- Task 0473 — introduces `WAYFINDER_MAP_TAG` and marks all eight maps. **Hard blocker.**
- Task 0475 — split parent; edits the same file (`packages/app/src/services/task-check.ts`).
- Task 0472 — sibling gate-correctness ticket (a gate that fails to fire).
- `packages/app/src/services/task-check.ts` — DD-09 subset comparison emitting `L4.uncovered-task-scenario`.
- `packages/config/src/finding-codes.ts` — finding-code catalog.
### History
- 2026-08-08T19:43:07.666Z todo → wip (system)
- 2026-08-08T19:43:11.094Z wip → testing (system)
- 2026-08-08T19:43:59.831Z testing → done (system)
