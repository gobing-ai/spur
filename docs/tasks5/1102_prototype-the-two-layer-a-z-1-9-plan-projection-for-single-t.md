---
schema_version: 1
name: Prototype the two-layer A-Z/1-9 plan projection for single-task and batch runs
status: done
template: feature-impl
created_at: 2026-10-07T05:39:25.241Z
updated_at: "2026-10-07T19:25:28.974Z"
feature_id: I13

done_forced: "true"
done_reason: "wayfinder prototype ticket; no task pipeline run, verify PASS recorded from answer file"
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

- [x] R1. Prototype phase grouping for `task-pipeline.yaml` and `idea-pipeline.yaml`: a per-state display phase (rough form: optional YAML metadata or a side table) that maps happy-path states to letters B..; failure/loop/terminal states are hidden from the initial plan and inserted as the next digit under their phase only when entered.
- [x] R2. Prototype a single-task projection: letter A = Prepare (A1 Quick readiness, A2 Prepare Git, A3 Publish plan), B.. = workflow phases, digits = steps; render it for both pipelines and attach the output.
- [x] R3. Prototype a batch projection: A = Prepare batch, one letter per task (B..Y, title as `B 0812 <title>`), digits = that task's phases, Z = Batch report; batches over 24 tasks split into waves, each wave its own A..Z plan. Render it for a real `feature:<id>` set.
- [x] R4. Enforce the A-Z / 1-9 cap: show where fold/wave logic lives and that a definition whose phase exceeds 9 steps fails a validation check at authoring time (`spur workflow validate` or equivalent), never emitting AA or A10.
- [x] R5. Show the progress update sequence for one realistic run (including a test-fix loop and a skipped conditional step) as a list of native-todo payload snapshots, proving labels stay stable and outcomes stay truthful per 0814 R6.
- [x] R6. Prototype per-host rendering from the 1101 matrix (`docs/analysis/2026-10-native-todo-adoption-audit.md` § R1): put the two-layer label in the item text (only omp nests natively). Handle both update styles, per-item create/update (Claude Code `TaskCreate`/`TaskUpdate`, pi `todo`) and full-list rewrite (Codex `update_plan`, Gemini `write_todos`, OpenCode `todowrite`, Grok `todo_write`). Map statuses where `skipped` does not exist (render it in the text and never mark it completed). Show R5's snapshots in one per-item host and one full-list host.

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

Scenario: AC5 — Same plan renders on per-item and full-list hosts (req: R6)
  Given the R5 run snapshots
  When they are rendered for a per-item host and a full-list host
  Then both show identical labels and text, statuses map to each host's vocabulary, and no skipped step is marked completed
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

Prototype: `docs/analysis/2026-10-plan-projection-prototype.ts` (run from repo root; 37 assert self-checks, exits nonzero on failure). Rendered output: `docs/analysis/2026-10-plan-projection-prototype.md`. State lists are read live from `spur workflow show <yaml> --format todo --json` (`docs/analysis/2026-10-plan-projection-prototype.ts:361`), so the only new input is the phase table.

- **R1 phase grouping** — side table `PHASES` at `docs/analysis/2026-10-plan-projection-prototype.ts:40`; each state is `plan` or `on-entry`. task-pipeline: B Implement, C Test, D Review, E Verify & record; idea-pipeline: B Discover … F Hand off. task-pipeline 16 states → 15 plan items; `escalate`, `test-fail-triage`, `test-fix`, `test-recheck`, `review-fail-triage`, `approve` appear only when entered; terminal states never appear (`docs/analysis/2026-10-plan-projection-prototype.md:7-27`).
- **R2 single-task** — `singlePlan` at `docs/analysis/2026-10-plan-projection-prototype.ts:157`: A Prepare (A1–A3) + phases. Rendered for both pipelines at `docs/analysis/2026-10-plan-projection-prototype.md:7-56`. Item text is `<label> <title> · <state-id>` so the agent and the run log share one key.
- **R3 batch** — `batchWaves` at `docs/analysis/2026-10-plan-projection-prototype.ts:282`: A Prepare batch (A1–A4), one letter per task (B..Y) with digits = the 4 phases, Z report, waves of 24. E71 (9 tasks) → 51 items (`docs/analysis/2026-10-plan-projection-prototype.md:58-114`); D62 (29 tasks) → 2 waves of 126 + 31 items (`docs/analysis/2026-10-plan-projection-prototype.md:116-155`). Order is WBS; the real driver topo-sorts.
- **R4 cap** — `letter`/`child` throw past Z / 9 (`docs/analysis/2026-10-plan-projection-prototype.ts:124-132`); `validate` rejects > 25 phases, > 9 states per phase (counting on-entry), unknown/terminal/duplicate/unassigned states (`docs/analysis/2026-10-plan-projection-prototype.ts:134`). Batches fold into waves; the cap is static because re-entry reuses the label with an `attempt N` note. Graduation home: the validator next to `buildWorkflowSteps` (`packages/app/src/workflow/step-reporter.ts:255-278`) run by `spur workflow validate`.
- **R5 run** — `Tracker` at `docs/analysis/2026-10-plan-projection-prototype.ts:178` replays precheck → implement → test (fail) → test-fix (C2 inserted) → test-recheck (C3) → triage → verify (fast mode, D2 review skipped) → verify PARTIAL → test-fix attempt 2 → … → record → done. Seven snapshots at `docs/analysis/2026-10-plan-projection-prototype.md:157-304`. Rules: forward move past a phase marks unentered steps skipped (`closePhase`, `docs/analysis/2026-10-plan-projection-prototype.ts:240`); loop-back leaves the later phase open; the first failed gate stays failed.
- **R6 hosts** — `codexPayload` (`docs/analysis/2026-10-plan-projection-prototype.ts:325`) and `claudeOps` (`docs/analysis/2026-10-plan-projection-prototype.ts:330`) render the same snapshots; status map at `docs/analysis/2026-10-plan-projection-prototype.ts:311`. skipped/failed/unattempted → host `pending` + `[outcome]` in the text, never `completed`. Output at `docs/analysis/2026-10-plan-projection-prototype.md:306-408`.

Findings for the map:

1. **Per-item hosts append inserted items at the end** — Claude Code order `… E1 E2 C2 C3` vs full-list `… C1 C2 C3 D …` (`docs/analysis/2026-10-plan-projection-prototype.md:407-408`). Labels keep identity; the order cannot be fixed without recreating items.
2. **Batch lists are large** — a full wave is 126 items. Acceptable for full-list hosts; noisy on per-item hosts (126 `TaskCreate` calls at publish).
3. **Status vocabulary** — the prototype uses `pending` + text for skipped everywhere; Gemini/OpenCode/Grok could use `cancelled`. Unresolved choice.
4. **Phase table home and public surface** — the side table must move into workflow YAML or next to `step-reporter.ts`, and `workflow show --format todo` emitting this plan is a public-surface change needing consent.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:7-56`: per-state phase grouping rendered for task-pipeline and idea-pipeline; self-checks `docs/analysis/2026-10-plan-projection-prototype.md:412-417` (phase tables validate, no terminal/on-entry state in initial plan) |
| R2 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:7-28`: single-task projection A Prepare (A1–A3) plus workflow phases B.. with digit steps; idea-pipeline at `docs/analysis/2026-10-plan-projection-prototype.md:29-56` |
| R3 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:58-155`: E71 9-task one-wave batch and D62 29-task two-wave batch; self-checks `docs/analysis/2026-10-plan-projection-prototype.md:421-423` |
| R4 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:418-420`: validator rejects a 10-state phase and 26 phases, label builder throws instead of emitting A10 |
| R5 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:157-304`: seven snapshots incl. test-fix insertion, skipped review, verify loop-back; self-checks `docs/analysis/2026-10-plan-projection-prototype.md:424-445` |
| R6 | MET | `docs/analysis/2026-10-plan-projection-prototype.md:306-408`: per-item and full-list host payloads from the 1101 matrix; self-checks `docs/analysis/2026-10-plan-projection-prototype.md:446-448` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Single-task plan shows phases, not raw FSM states (req: R1, R2) | MET | command | `bun docs/analysis/2026-10-plan-projection-prototype.ts` exit 0 this run, output byte-identical to `docs/analysis/2026-10-plan-projection-prototype.md:1-448`; self-checks `docs/analysis/2026-10-plan-projection-prototype.md:412-417` pass |
| AC2 — Batch plan maps one letter per task within A-Z (req: R3) | MET | command | same run; `docs/analysis/2026-10-plan-projection-prototype.md:421-423` 60 tasks fold to 3 waves of ≤24, every label matches ^[A-Z][1-9]?$, D62 splits into 2 waves |
| AC3 — Cap is never exceeded (req: R4) | MET | command | same run; `docs/analysis/2026-10-plan-projection-prototype.md:418-420` validator rejects 10-step phase and 26 phases, A10 throws |
| AC4 — Progress snapshots stay stable and truthful (req: R5) | MET | command | same run; `docs/analysis/2026-10-plan-projection-prototype.md:424-445` labels stable across loop-back, inserted test-fix takes C2, review ends skipped, nothing pending after done |
| AC5 — Same plan renders on per-item and full-list hosts (req: R6) | MET | command | same run; `docs/analysis/2026-10-plan-projection-prototype.md:446-448` skipped/failed never completed on either host, identical item text |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Map: `docs/features/I13_two-layer-plan-and-progress-visibility-for-dev-workflows.md`
- Prior contract: tasks 0695, 0727, 0768, 0814; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:131-187`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:244`
- Helpers: `packages/app/src/workflow/step-reporter.ts:255-278` (labels), `:390` (`renderProgressMarkdown`)

### History

- 2026-10-07T05:40:45.907Z backlog → todo (system)
- 2026-10-07T06:05:16.846Z todo → wip (system)
- 2026-10-07T06:11:59.771Z wip → testing (system)
- 2026-10-07T06:12:00.751Z testing → done (system)

