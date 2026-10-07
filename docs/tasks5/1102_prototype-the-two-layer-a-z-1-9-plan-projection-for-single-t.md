---
schema_version: 1
name: Prototype the two-layer A-Z/1-9 plan projection for single-task and batch runs
status: todo
template: feature-impl
created_at: 2026-10-07T05:39:25.241Z
updated_at: "2026-10-07T05:44:22.262Z"
feature_id: I13

---

## 1102. Prototype the two-layer A-Z/1-9 plan projection for single-task and batch runs

### Background

Wayfinder ticket (`wayfinder:prototype`) on map **I13 — Two-layer plan and progress visibility for dev workflows**.

Charting found the current plan is not a plan: `spur workflow show <task-pipeline> --format todo` lists all
16 declared FSM states (incl. `escalate`, `test-fix`, `triage`, `failed`, `cancelled`) as Layer 1, the
bootstrap rows `A..D` reuse the same letters as the workflow rows, and `columnLabel` emits `AA, AB…`
past Z. Operator decisions (map I13, Decisions so far) fix the model; this ticket prototypes it so the
contract can be reviewed against real output before graduation.

### Requirements

- [ ] R1. Prototype phase grouping for `task-pipeline.yaml` and `idea-pipeline.yaml`: a per-state display phase (rough form: optional YAML metadata or a side table) that maps happy-path states to letters B..; failure/loop/terminal states are hidden from the initial plan and inserted as the next digit under their phase only when entered.
- [ ] R2. Prototype a single-task projection: letter A = Prepare (A1 Quick readiness, A2 Prepare Git, A3 Publish plan), B.. = workflow phases, digits = steps; render it for both pipelines and attach the output.
- [ ] R3. Prototype a batch projection: A = Prepare batch, one letter per task (B..Y, title as `B 0812 <title>`), digits = that task's phases, Z = Batch report; batches over 24 tasks split into waves, each wave its own A..Z plan. Render it for a real `feature:<id>` set.
- [ ] R4. Enforce the A-Z / 1-9 cap: show where fold/wave logic lives and that a definition whose phase exceeds 9 steps fails a validation check at authoring time (`spur workflow validate` or equivalent), never emitting AA or A10.
- [ ] R5. Show the progress update sequence for one realistic run (including a test-fix loop and a skipped conditional step) as a list of native-todo payload snapshots, proving labels stay stable and outcomes stay truthful per 0814 R6.

### Acceptance Criteria

ac_altitude: task-local
ac_numbering: task-local

```gherkin
Scenario: AC1 — Single-task plan shows phases, not raw FSM states (req: R1, R2)
  Given task-pipeline.yaml and idea-pipeline.yaml
  When the prototype projection renders the initial plan
  Then Layer 1 is A Prepare plus curated phases and no failure, loop, or terminal state appears

Scenario: AC2 — Batch plan maps one letter per task within A-Z (req: R3)
  Given a real feature task set
  When the batch projection renders
  Then A is batch preparation, each task has its own letter with phase digits, and Z is the batch report

Scenario: AC3 — Cap is never exceeded (req: R4)
  Given a definition or batch that would exceed 26 letters or 9 digits
  When it is projected or validated
  Then it is folded into waves or rejected at validation, and no AA or A10 label is emitted

Scenario: AC4 — Progress snapshots stay stable and truthful (req: R5)
  Given a run with a test-fix loop and a skipped conditional step
  When the payload snapshots are produced
  Then inserted steps take the next digit under their phase, earlier labels never change, and skipped work is not marked completed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Rough prototype on a branch; output artifacts are rendered plans and payload snapshots attached here.
Reuse `buildWorkflowSteps` / `labelChild` in `packages/app/src/workflow/step-reporter.ts` rather than a
second builder; the state list still comes from the CLI projection (never hand-copied, per
inline-pipeline-driver § Source of truth). Any public `spur workflow show` output change is a proposal
only — public-surface consent is required before graduation. Exact phase membership per state is a
prototype output the operator reviews, not a decision this ticket makes final.

### Plan

1. Draft phase grouping for both pipelines and the hidden-until-entered rule (R1).
2. Render single-task plans (R2) and a batch plan against a real feature set (R3).
3. Add cap/fold/wave handling and an authoring-time validation stub (R4).
4. Produce payload snapshots for a loop + skip scenario (R5); attach artifacts and record resolution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Map: `docs/features/I13_two-layer-plan-and-progress-visibility-for-dev-workflows.md`
- Prior contract: tasks 0695, 0727, 0768, 0814; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:131-187`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:244`
- Helpers: `packages/app/src/workflow/step-reporter.ts:255-278` (labels), `:390` (`renderProgressMarkdown`)

### History

- 2026-10-07T05:40:45.907Z backlog → todo (system)

