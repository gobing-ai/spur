---
schema_version: 1
name: Record runall-P1 pilot evidence for scoped-gate and budget adoption (feature R, D62 input)
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:48.676Z
updated_at: "2026-10-07T15:58:30.990Z"
feature_id: H15

---

## 1107. Record runall-P1 pilot evidence for scoped-gate and budget adoption (feature R, D62 input)

### Background

The i31 baseline (`docs/reports/i31/0912-workflow-baseline.md`) marks scoped-gate claims F3/F4 INSUFFICIENT_EVIDENCE pending a pilot sample; the D62 driver-adoption decision (ADR) is blocked on exactly that evidence. Session batch runall-P1-20261006-02 (P1 tasks 1095–1099, 2026-10-06) produced the sample but the numbers live only in the session transcript and gitignored `.spur/run/` driver artifacts (driver tree `spur-new-wt-p1` was removed after merge).

### Requirements

- [ ] R1. A committed report under `docs/reports/` records the batch's wall-clock decomposition: serial phase (1095, ~3.5h incl. 25-min verify fix loop and two 30m timeout kills) vs parallel phase (1097–1099, wall ≈ max implement + serialized merge chain), with the five root-cause fixes and their effect on the remaining four tasks.
- [ ] R2. The report carries gate-economy numbers: 4 per-slice full-gate runs replaced by 1 integrated gate (388s) on the integrated tree, plus first-attempt verify-verdict chain (1095: fix loop; 1096–1099: four consecutive first-attempt PASS after the verify-answer + implement briefs were introduced).
- [ ] R3. The i31 baseline's F3/F4 rows and D62 adoption note cite the report path, converting their INSUFFICIENT_EVIDENCE marks into pilot evidence (upgrade or scoped adoption per D62's own criteria).

### Acceptance Criteria

- [ ] AC1 — The runall-P1-20261006-02 pilot evidence is recorded and cited by the scoped-gate adoption decision D62

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

- 2026-10-07T07:34:13.238Z backlog → todo (system)

### Notes

Re-homed: created under transient root feature "R", then moved to H15 (spur-dev umbrella family, owner of 0931 parallel batch isolation) with the rest of the batch-execution performance set. Source anchors for the numbers: batch commits `c59d9312c`…`4f682cb96` + wrap `01b2ca063` + merge `90a435a0f` (git history is the durable record); scratch state `/tmp/p1-batch-state.json` may be gone — do not depend on it. Report contract: see `sp:spur-dev` plan/report templates (`references/document-authoring.md`); place under `docs/reports/` following the i31 baseline's sibling layout. Do not edit the ADR text of D62 itself — cite it from the baseline rows and the report; adoption wording belongs to the decision owner.

