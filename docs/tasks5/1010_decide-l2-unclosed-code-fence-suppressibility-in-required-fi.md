---
schema_version: 1
name: Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:17.374Z
updated_at: "2026-09-29T19:28:46.637Z"
feature_id: F91

ac_altitude: task-local
---

## 1010. Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)

### Background

Origin: task 1008 review finding P3-2 (verbatim): "L2.unclosed-code-fence is not in REQUIRED_FINDING_CODES (`packages/app/src/services/planning-check-base.ts:76-88`), so `tasks.severity` config may downgrade it to warning/off. Default emit severity is error (R2 met), but a fail-closed corruption signal arguably merits unsuppressible treatment like L2.missing-required-section. Design choice for the operator to confirm."

Mechanism (verified on main):

- `REQUIRED_FINDING_CODES` (`packages/app/src/services/planning-check-base.ts:76-88`) is the frozen set of codes that cannot be downgraded by `severityOverrides` nor absorbed by accepted-map filtering. Header comment: callers MAY extend it for project-specific essential errors but MUST NOT shrink it; frozen at the planning-check-base seam so `TaskCheckService` and `FeatureCheckService` share one policy.
- Current members: `L1_MARKDOWN_PARSE`, `L1_SCHEMA_VALIDATION`, `L2_MISSING_REQUIRED_SECTION`, `L3_AC_BDD_ERROR`, `L3_AC_BDD_INVALID`, `L3_REQUIREMENTS_EMPTY`, `L3_AC_EMPTY`, `L3_REQUIRED_SECTION_PLACEHOLDER`, `REQUIRED_REFERENCE_CODES`, `L4_PREREQUISITE_CYCLE`, `COMPLETION_FINDING_CODES`.
- Emission site (`planning-check-base.ts:228-241`) pushes `L2.unclosed-code-fence` with severity `error` and a fail-closed message — this task does not change emission either way.
- The config surface is `tasks.severity` (severityOverrides), documented in the finding-code catalog of `docs/design/configuration-contracts.md` (counts sentence near :49 was already corrected to 63/L2×6 by task 1008 P2-1).

Why it matters (F91 intent): an unclosed fence makes `findHeadings` see a truncated prefix — every later section is invisible and downstream checks pass on corrupted input. A corruption signal the config can silence partially defeats the corpus gate. Counter-argument for keeping it suppressible: legacy files with stray fences would hard-fail checks with no escape hatch. This is a product decision, not a mechanical fix.

### Requirements

- **R1 (decision recorded)** — decide whether `L2.unclosed-code-fence` is unsuppressible; record the decision + rationale in `docs/design/configuration-contracts.md` finding-code catalog (suppression-policy row).
- **R2 (implement per decision)** — branch A (suppression disallowed): add `FINDING_CODES.L2_UNCLOSED_CODE_FENCE` to `REQUIRED_FINDING_CODES` (`packages/app/src/services/planning-check-base.ts:76-88`) + regression test proving `severityOverrides` cannot downgrade it and accepted-map filtering cannot absorb it. Branch B (escape hatch intentional): document explicitly in `configuration-contracts.md` which L2 codes stay suppressible and why, so the asymmetry vs `L2.missing-required-section` is a recorded decision rather than an accident.

Detail: emission severity stays `error` in both branches (`planning-check-base.ts:228-241` untouched); no caller-side changes — the shared set at the planning-check-base seam is the only implementation surface.

### Acceptance Criteria

- [ ] AC1 — Decision + rationale recorded in `docs/design/configuration-contracts.md` finding-code catalog (req: R1)
- [ ] AC2 — Implementation matches the decision: branch A — `REQUIRED_FINDING_CODES` contains `L2_UNCLOSED_CODE_FENCE` with a regression test (override attempt still yields severity `error`); branch B — contract doc documents the intended escape hatch (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Recommendation on record (from the 1008 review): branch A — the fence code belongs beside `L2_MISSING_REQUIRED_SECTION`; both mean "the parsed view is truncated; later sections are invisible", both fail closed. A corruption signal the config can silence is the gap F91 exists to close.

Implementation steps:

1. Locate the existing severity-override tests: `rg -n "severityOverrides|REQUIRED_FINDING_CODES" packages/app/tests` — add the regression case there (both check services inherit the seam; one test suffices).
2. Branch A: add `FINDING_CODES.L2_UNCLOSED_CODE_FENCE` to the set literal at `packages/app/src/services/planning-check-base.ts:76-88`; assert in the test that a `tasks.severity` override targeting the code leaves severity `error` and the finding survives accepted-map filtering.
3. Same-commit doc touch: `configuration-contracts.md` — suppression-policy row for the code (and counts sentence only if the policy table shape changes).

Constraints (anti-drift):

- Do NOT touch the emission logic or default severity (`planning-check-base.ts:228-241`).
- Do NOT shrink the set (the header comment forbids it — MUST NOT shrink).
- No plugin-bundle regen needed: `packages/app` is not a bundled plugin surface.
- `ac_altitude: task-local` is already set — do not remove.

Verify: targeted `bun test` in `packages/app`; `bun run spur-check` at the quality boundary.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-2; Dimension 2)
- Code anchors: `packages/app/src/services/planning-check-base.ts:76-88` (set), `:228-241` (emission) · `docs/design/configuration-contracts.md:49` (catalog)
- Tasks: 1008 (source; Review table row P3-2), 1009 (sibling fence follow-up) · Feature: F91

### History
