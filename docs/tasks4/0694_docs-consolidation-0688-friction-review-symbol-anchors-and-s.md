---
schema_version: 1
name: "Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.953Z
updated_at: "2026-08-27T20:19:54.774Z"
feature_id: F94
priority: P3
dependencies: ["0691"]
---

## 0694. Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline

### Background

Two documentation riders from the 0688 friction review (2026-08-27), consolidated into one docs pass landing in `docs/04_DESIGN.md` + the verification-gate docs:

- **Symbol-anchor convention:** prefer `path:symbol` over `path:line` — line anchors rot (0606 precedent: `eval-pipeline.ts:528` drifted to `:562`; PROMOTION_BAR_PROPOSAL move).
- **Sweep-once discipline:** iterate with single-task `spur task check <wbs>`; run the `task check --corpus` sweep once, at commit-prep — 17 sweeps × ~60s ≈ 17 min burned in the 0688 session.

Sequencing: the gate docs depend on the corpus gate & baseline simplification ADR outcome (dependency wired to that task), so this task starts after it.

### Requirements

- [ ] R1. **Symbol-anchor citation convention** — document in the authoring guidance that owns
      citation forms: prefer `path:symbol` over `path:line` for new task citations and test
      evidence; state when a line anchor is still acceptable; include a dated corpus note
      recording the 0688-review decision.
- [ ] R2. **Sweep-once discipline** — codify in the verification-gate docs: single-task check
      drives the iterate loop; one `--corpus` sweep before commit.
- [ ] R3. **One pass** — land both in `docs/04_DESIGN.md` + the verification-gate docs in a
      single pass.

### Acceptance Criteria

- [ ] AC1. A new author finds the preferred `path:symbol` form, the reason, the line-anchor exception, and the dated decision note linking back to this feature.
- [ ] AC2. The verification-gate docs state the sweep-once discipline (single-task check iterates; `--corpus` runs once before commit).
- [ ] AC3. Both land in one pass across docs/04_DESIGN.md + the verification-gate docs.

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
