---
schema_version: 1
name: "Project the environment-improvement lens into dogfood and history-anatomy reports"
status: todo
template: feature-impl
created_at: 2026-08-27T00:28:30.651Z
updated_at: "2026-08-27T00:28:30.653Z"
feature_id: I9
priority: P2
tags: ["environment-lens", "dogfood-testing", "history-anatomy"]
---

## 0686. Project the environment-improvement lens into dogfood and history-anatomy reports

### Background

Feature I9 builds brainstorm Approach 1 (`docs/plans/2026-08-26-retro-skills-brainstorm.md`) and the accepted design satellite `docs/design/environment-improvement-lens.md` (ADR-084/085): one plugin-level mapping projected into the two live report owners. No third skill, no `/sp:dev-retro`, no public CLI change.

Implements:
- R1 — A single plugin-level mapping owns the seven retro categories and the placement rule
- R2 — Dogfood and history-anatomy projections point at the mapping rather than duplicating it
- R3 — A dogfood section 6 finding may carry an optional environment, testee, or waste tag without leaving protocol @1.2
- R4 — An untagged dogfood report remains valid under protocol @1.2
- R5 — Dogfood fix-mode does not apply environment-tagged findings as tree mutations
- R6 — History-anatomy encodes retro names as signal or owner-surface values and rejects them as categories
- R7 — History-anatomy environment remediations remain operator proposals
- R8 — Steering, navigation, and coding-standards remediations are classified as environment changes, not implementer bugs
- R9 — An automated-check candidate proposes a gate rather than a new always-loaded sentence
- R10 — sp:issue-finding stays a coexistence-window non-target
- R11 — The two named SKILL.md bodies do not grow past their BODY_BUDGET baselines
- R12 — A history-anatomy fixture that uses only the closed category vocabulary still passes the structure gate
- R13 — history-anatomy SKILL.md stays a dispatcher and does not absorb the mapping
- R14 — Existing cache-health P3 findings remain valid without a waste tag

Rejected split: four entries (mapping / dogfood projection / history-anatomy projection / fixtures) from the brainstorm next-steps list. Scenario count is not task count. The mapping is not independently demoable; fixtures are per-task tests; R1/R2 uniqueness tests span both projections and must be reviewed as one diff. A two-way dogfood vs history-anatomy split still contends on `plugins/sp/references/environment-lens.md` (H8 cohesion). Hours stay under `force_decompose_above_hours` (16).

Surfaces (one rollback boundary):
- `plugins/sp/references/environment-lens.md` (new mapping SSOT)
- `plugins/sp/skills/dogfood-testing/references/report-template.md` §6 (optional class tag + classification + fix-mode exclusion)
- `plugins/sp/skills/history-anatomy/references/report-contract.md` section 9 (signal grammar + projected-candidate fields)
- `plugins/sp/scripts/history-anatomy-cache.ts` plus the `history-anatomy-cache.mjs` twin (additive retro-as-category reject in `checkReportStructure`)
- structural tests and fixtures in `plugins/sp/tests/`

`validate-report` gains no required fields. Do not grow `dogfood-testing` or `issue-finding` SKILL.md. Do not edit `plugins/sp/skills/issue-finding/`. Do not unfreeze the closed category vocabulary.

Rubric: E2 D1 L1 C0 R0 = 4 → kept whole (decomposition optional; cohesion forbids split; no independent parallel streams, no distinct review gate, one plugin, one deliverable).

### Requirements

- [ ] R1. Add exactly one mapping file under `plugins/sp/references/` that enumerates the seven retro categories (navigation, automated checks, coding standards, AGENTS.md placement, tool economy, no-ops, information access) and the implementer-versus-reviewer placement rule (prefer an automated check over a new always-loaded sentence; place coding standards on the review path not the implementer skill; keep AGENTS.md as navigation pointers); no other file restates those seven names as a second category table.
- [ ] R2. Point `plugins/sp/skills/dogfood-testing/references/report-template.md` and `plugins/sp/skills/history-anatomy/references/report-contract.md` at that mapping as the category table; neither file redefines the seven retro names with different wording.
- [ ] R3. Allow an optional closed class tag `environment` | `testee` | `waste` on dogfood §6 findings without leaving protocol `sp:dogfood-testing@1.2`; `validate-report.mjs` accepts tagged and untagged reports, including an untagged cache-health P3, and gains no required fields.
- [ ] R4. Keep dogfood fix-mode from Edit/Write of AGENTS.md, skills, rules, or other environment sources for an environment-tagged finding; the finding stays a recommended action in §6. Testee-class step-failure fixes are unchanged.
- [ ] R5. Keep history-anatomy closed categories frozen (`reliability | repetition | workflow | performance | coverage | telemetry | positive`). Encode retro names as `<signal>` or owner-surface. Extend `checkReportStructure` so a finding whose `category` or key first segment is a retro name fails, while the same name in `<signal>` or owner-surface passes; a closed-vocabulary-only fixture, including section 9 numbered prose without I9 proposal fields, still passes. Refresh the `history-anatomy-cache.mjs` twin.
- [ ] R6. Require each projected section 9 environment candidate to name owner surface, expected impact, verification method, and reversibility; unprojected numbered prose stays valid. The report contains no applied change, no diff, and no command it claims to have run.
- [ ] R7. Classify a navigation delay, a dead always-loaded instruction, and a missed coding standard as `environment` rather than `testee`; a coding-standards finding names a review owner surface (`sp:code-verification`, `sp:code-review`, or pipeline review), never the implementer skill. An automated-check candidate proposes a new or tighter check, not a new sentence in AGENTS.md or another always-loaded steering file.
- [ ] R8. Leave `plugins/sp/skills/issue-finding/` unedited (`SKILL.md` ≤ 27,060 bytes, no new finding category, flag, or lens projection). Keep `dogfood-testing` SKILL.md ≤ 37,452 bytes and `history-anatomy` SKILL.md under 20,000 bytes with no copied seven-name table. Prove the mapping and both projections live outside those SKILL.md files.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
