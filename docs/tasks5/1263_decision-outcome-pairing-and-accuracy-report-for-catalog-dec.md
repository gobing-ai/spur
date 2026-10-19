---
schema_version: 1
name: Decision outcome pairing and accuracy report for catalog decisions
status: todo
template: issue
created_at: 2026-10-19T18:27:32.374Z
updated_at: "2026-10-19T18:27:42.673Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["1262"]
---

## 1263. Decision outcome pairing and accuracy report for catalog decisions

### Background

Split out of task 1262 (decision-maker reliability) so 1262 stays within 10 requirements.

Spur measures decision makers by **acceptance rate and confidence only**. Neither shows whether a
decision was right. The 2026-10-19 audit showed why that matters:
- `review-failure-class` (fm-local) was accepted 15/15 at confidence 1.0, always answering `fix`,
  which is also its fallback. A perfect accept rate with zero information.
- `task-triage` (clef) was accepted 2/36. Nothing tells us whether the 34 fallbacks (safety lane)
  cost anything or were correct.
- Sampled makers (fm-local, and ts-libs' planned `llm-agent`) report unanimity, not calibration
  (ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity). A confidence
  floor alone cannot be tuned against them.

Every later improvement needs (value, outcome) pairs: choosing a maker per decision, tuning
`minConfidence` per decision, comparing a shadow maker, and the planned upstream routing work in
the ts-libs decision hub (maker fallback chains, confidence cascades). This task produces those
pairs and nothing else.

Current state:
- Decision results land in `.spur/run/<wbs>-<id>.decision` (JSON: value, reason, maker,
  confidence) and, when the bus is wired, in `.spur/spur.db` `system_events` `decision.end` rows.
  Task 1262 R2 fixes the missing rows.
- `packages/app/src/workflow/actions/decide.ts` `catalogRow` always writes
  `evidenceDigest: null` in the result row. The digest exists only in service events, so a result
  cannot be joined back to its evidence.
- Outcomes already exist but are not linked: the review verdict (`.spur/run/<runId>-review-answer.txt`,
  the task's `## Review` P1–P4 findings), the gate result after remediation, and the route log
  `.spur/memory/task-pipeline-routes.log` (`task-pipeline.yaml:469`).

### Requirements

- [ ] R1. Every decision result (`.decision` file and `decision.end` row) carries a stable `decisionCallId` (run id + step id + attempt) and the real `evidenceDigest`; `decide.ts` `catalogRow` stops writing `null`.
- [ ] R2. Add an outcome record keyed by `decisionCallId`: `{decisionCallId, decisionId, outcome, observedAt, source}` stored in `.spur/spur.db` (a `decision.outcome` system event is enough, so no new table).
- [ ] R3. task-pipeline emits outcomes deterministically: `task-triage` → the review's highest finding severity (none/P4…P1) at record time; `failure-class` → the class of the step that turned the gate green (or `unresolved`); `review-failure-class` (while it exists) → the next transition actually taken.
- [ ] R4. `spur decision report <decision-id> [--since <date>] [--json]` prints, per maker, call count, reason distribution, value × outcome confusion counts, and accepted-vs-fallback accuracy where an outcome mapping is declared.
- [ ] R5. Declare the value → expected-outcome mapping beside the decision in the catalog (an optional `outcomes:` block, ignored by the ts-libs hub) or in Spur config, so `report` can score accuracy. Document the field. If it must live in the ts-libs catalog schema, record that as an upstream request rather than forking the schema.
- [ ] R6. Document in the Spur decision docs how to read the report: acceptance ≠ accuracy, sampled-maker confidence = unanimity, and how to retune `minConfidence` from it.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a decision result joins to its evidence and outcome (req: R1, R2)
  Given a task-pipeline run that makes a `task-triage` decision and completes review
  When `system_events` is queried by the decision's `decisionCallId`
  Then one `decision.end` row with a non-null `evidenceDigest` and one `decision.outcome` row are returned

Scenario: AC2 — triage outcome is the review's top severity (req: R3)
  Given a fixture run whose review reports one P2 finding
  When the run records
  Then the `task-triage` outcome is `P2`

Scenario: AC3 — the report shows accuracy, not just acceptance (req: R4, R5)
  Given recorded fixture decisions with outcomes and a declared outcome mapping
  When `spur decision report task-triage --json` runs
  Then it returns per-maker reason counts, the value × outcome matrix, and accepted-vs-fallback accuracy

Scenario: AC4 — the reading guide exists (req: R6)
  Given the Spur decision documentation
  When a reader looks up `spur decision report`
  Then it explains acceptance vs accuracy, sampled-maker unanimity, and floor retuning
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- **Events, not a new table.** `decision.outcome` rides the existing `system_events` bus, the same seam as `decision.end` (fixed by 1262 R2, a hard prerequisite). The report is a read over that table.
- **Outcomes are deterministic.** Each one comes from an artifact the pipeline already writes (review findings, gate exit codes, transitions). No model judges another model.
- **Keep the scope small.** No shadow makers, no automatic floor tuning, no routing changes here. Those come after there is enough data, and the generic parts (maker chains, cascades, shadow) belong upstream in the ts-libs `DecisionHub`, not in Spur. This task only produces the data they need.
- **Volume check.** At about 36 triage calls in 11 days, a usable confusion matrix takes weeks. Start recording now.

### Plan

1. Blocked on 1262 R2: confirm `decision.end` rows exist on all engine paths.
2. R1: write a failing test asserting a non-null `evidenceDigest` and the presence of `decisionCallId`; fix `catalogRow`.
3. R2/R3: emit `decision.outcome` from the record step; E2E fixture run (AC1, AC2).
4. R5/R4: add the outcome mapping and the `decision report` command; JSON-output E2E (AC3).
5. R6: write the docs.
6. Run the project gates.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 1262 (prerequisite R2: ledger wiring; R5/R6: triage and review-failure-class rework consume this data).
- `packages/app/src/workflow/actions/decide.ts:222-249` (emission, `catalogRow`), `config/workflows/task-pipeline.yaml:399-470,523-531,697-706`.
- ts-libs `packages/ai-decision/README.md` § The fallback contract; `docs/design/llm-agent-decision-backend.md` § Confidence granularity.
- knowledge-kit task 0317 R4 (the same ground-truth idea there: labels × selections).

### History
