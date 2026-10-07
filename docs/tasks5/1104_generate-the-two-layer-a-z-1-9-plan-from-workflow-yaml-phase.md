---
schema_version: 1
name: Generate the two-layer A-Z/1-9 plan from workflow YAML phases in workflow show and validate
status: backlog
template: feature-impl
created_at: 2026-10-07T06:14:17.109Z
updated_at: "2026-10-07T06:14:50.326Z"
feature_id: I13

dependencies: ["1103"]
---

## 1104. Generate the two-layer A-Z/1-9 plan from workflow YAML phases in workflow show and validate

### Background

Graduated from map I13 after the 1102 prototype (`docs/analysis/2026-10-plan-projection-prototype.ts`). The operator approved
the prototype's phase table (`docs/analysis/2026-10-plan-projection-prototype.ts:40`), approved putting it in workflow YAML, and
approved `spur workflow show --format todo` emitting the labeled two-layer plan (public surface). Today `columnLabel`
(`packages/app/src/workflow/step-reporter.ts:255`) emits `AA` and `labelChild` has no 9 cap.

### Requirements

- [ ] R1. Annotate `config/workflows/task-pipeline.yaml` and `idea-pipeline.yaml` states with the approved display phases (prototype table); regenerate the bundle.
- [ ] R2. Projection in `packages/app/src/workflow/step-reporter.ts`: `A Prepare` (A1–A3) plus phases B.., digits = `plan` states, item text `<label> <title> · <state-id>`; `on-entry` states take the next digit only when entered; terminal states never appear. Replace the AA/unbounded labels with a hard A–Z / 1–9 cap.
- [ ] R3. `spur workflow validate` rejects: a non-terminal state without a phase, > 25 phases, > 9 states in a phase (counting on-entry), a terminal state with a phase.
- [ ] R4. `spur workflow show --format todo --json` emits the ready-to-publish item list; update `docs/design/` satellite and `sp:spur-cli` reference.
- [ ] R5. Batch projection helper: `A` Prepare batch, one letter per task (`B 0812 <title>`), `Z` Batch report, waves of 24; **letters first** — phase digits are added when a task starts, not published up front.
- [ ] R6. Status rendering: skipped / failed / unattempted map to host `pending` with an `[outcome]` text suffix on every host; never `completed`.
- [ ] R7. Port the prototype's self-checks into tests (cap, validation, label stability across loop-back, skipped never completed).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

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
