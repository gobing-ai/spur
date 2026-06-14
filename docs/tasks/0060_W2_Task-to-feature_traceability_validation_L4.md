---
name: "W2: Task-to-feature traceability validation (L4)"
description: "W2: Task-to-feature traceability validation (L4)"
status: Done
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-14T22:03:00.475Z
folder: docs/tasks
type: task
feature-id: F3
priority: P1
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0060. "W2: Task-to-feature traceability validation (L4)"

### Background

Design §3 L4, DD-09, C04 absorbed into the check verbs.


### Requirements

R1. Task AC ⊆ linked feature AC by normalized scenario title.
R2. Orphan feature scenarios = warnings.
R3. Dangling feature_id/parent_wbs/dependencies warnings.
R4. Surfaced in both task check and feature check.


### Q&A



### Design

Authority: design §3 L4 + §3.3 coverage contract (DD-09: task covers a feature scenario when a
normalized-title match exists; subset rule on the task side; orphan feature scenarios are warnings —
features legitimately precede decomposition), C04 (one validation surface: traceability lives inside
`task check` and `feature check`, no separate verb).


### Solution

1. Consume `checkAcCoverage` (0043) from both check services: task side reports uncovered task scenarios
   (error-level only if the hard core says so — default warning), feature side reports orphans + dangling
   edges; dangling `dependencies`/`parent_wbs` warnings on the task side.
2. Findings carry both sides of the edge (wbs ↔ feature id, scenario titles) for actionable output.
3. Tests: fixture pairs (feature AC + linked tasks) covering full/partial/zero coverage, R-id-prefixed
   titles, checklist-tier ACs.
4. Same commit: `04 §7.2/§7.4` traceability rows. Gate: `bun run check`; ≥90%.


### Plan

- [x] R1: task-check L4 consumes shared `checkAcCoverage` (0043) — task AC ⊆ feature AC by normalized title; uncovered = warnings (C04 default)
- [x] R2: feature-check L4 reports DD-09 coverage-based orphans (feature scenarios covered by no linked task) as warnings
- [x] R3: dangling `feature_id`/`parent_wbs`/`dependencies` edge warnings (already in task-check L4)
- [x] R4: traceability surfaced in BOTH `task check` and `feature check`
- [x] Refactor: extract shared `stripAcFence` into the BDD module (`@gobing-ai/spur-domain`); both services use it
- [x] Tests: fixture pairs (full/partial/zero coverage, R-id-prefixed titles)
- [x] R-doc: `04_DESIGN §7.1/§7.2` AC-coverage rows


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0060 --force --fix all`)

As shipped, R3 (dangling edges) was already in task-check's L4, but R1 (AC coverage / subset rule) and R2's
coverage-based orphans were UNMET — `checkAcCoverage` (0043) existed but was consumed by neither check
service. R4 (both surfaces) was only half-done (dangling on the task side). Fixed all during the fix-pass.

**S — Security:** Read-only validation; no injection surface. Coverage matching goes through the shared
`@gobing-ai/spur-domain` `checkAcCoverage`/`normalizeTitle` (never a private matcher).

**C — Correctness / architecture:**
- R1 ✓ task-check L4 now runs `checkAcCoverage(featureAc, taskAc, taskChecklist)` when a task has a
  `feature_id` + AC; uncovered task scenarios (subset-rule violations) are **warnings** by default (C04:
  errors only when the hard core / `--strict` elevates). Title-normalized matching (R-id prefix + case
  ignored) verified.
- R2 ✓ feature-check L4 now reports coverage-based orphans (feature scenarios covered by no linked task's
  AC) as warnings (DD-09 — a feature legitimately precedes decomposition). Computed by intersecting
  per-task orphan sets (concatenating multiple `Feature:` blocks would only parse the first — verified).
- R3 ✓ Dangling `feature_id`/`parent_wbs`/`dependencies` edges already warned in task-check L4 (pre-existing).
- R4 ✓ Both surfaces: coverage + edges in `task check`; coverage-orphans + incoming edges in `feature check`.
- Refactor: extracted the duplicated AC `stripCodeFence` into a shared `stripAcFence` in the BDD module
  (`@gobing-ai/spur-domain`), now used by both check services (was a copy in feature-check from 0057).

**U — Usability:** Findings name the scenario title + the feature/wbs for actionable output.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | R1 unimplemented: `checkAcCoverage` (0043) existed but neither check service consumed it — no task-AC-⊆-feature-AC subset check. | Correctness | `task-check.ts` runL4 | P1 | **FIXED** — task-check L4 runs `checkAcCoverage`; uncovered task scenarios = warnings; title-normalized. |
| 2 | R2 unimplemented: feature-check had a "zero linked tasks" orphan (0057) but not the DD-09 coverage-based orphan (scenarios covered by no task). | Correctness | `feature-check.ts` runL4 | P2 | **FIXED** — per-task orphan intersection → coverage-orphan warnings. |
| 3 | Duplicated AC fence-stripper (`stripCodeFence` copy in feature-check) — would need a third copy for task-check. | Maintainability | `feature-check.ts` | P3 | **FIXED** — extracted `stripAcFence` into the shared BDD module; both services use it. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1079 pass / 0
fail · `task-check.ts` + `feature-check.ts` both 100% line+func.


### Testing

Verified 2026-06-14. Tests genuine (real assertions); fixture pairs per the Solution.

- `packages/app/tests/services/task-check.test.ts` — R1 AC coverage across the **full/partial/zero**
  spectrum (Solution line 53): zero (a lone task scenario not in the feature warns), full (a covered
  scenario → no warning), partial (two-scenario task → only the uncovered one warns, the covered one is
  not flagged); title normalization (R-id prefix + case); **checklist-tier** AC — a `- [ ]` item covers a
  feature scenario by normalized text, and a non-matching item warns.
- `packages/app/tests/services/feature-check.test.ts` — R2: a feature scenario covered by no linked task is
  a coverage-orphan warning (one of two scenarios orphaned; never an error).
- Both built on fixture pairs (feature AC + linked task AC) — fenced Gherkin and checklist tiers.

Coverage: `task-check.ts` and `feature-check.ts` both 100% line+func. Full suite: 1079 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


