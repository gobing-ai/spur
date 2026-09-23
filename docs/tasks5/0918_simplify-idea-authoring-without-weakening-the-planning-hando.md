---
schema_version: 1
name: Simplify idea authoring without weakening the planning handoff
status: done
template: standard
created_at: 2026-09-22T02:56:46.302Z
updated_at: "2026-09-23T17:56:20.806Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w05
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914"]
---

## 0918. Simplify idea authoring without weakening the planning handoff

### Background

idea-pipeline.yaml currently runs separate planner calls for discovery, feature creation/intent, and AC authoring. The feature-create state creates or selects the feature and writes Goal/Scope through Spur; ac-generate writes AC through Spur, then deterministic AC and requirement-coverage checks run. The candidate is to author an AC draft in the feature-create call and retain the existing AC repair call only when checks fail. This preserves the idea-evaluation and design-approval taste gates, task decomposition, ready preparation and handoff. It delivers D63 R5 and depends on completed 0914 for installed inline execution.

The 0912 discovery sample found ten idea-pipeline rows: one DB done, four failed and five running/stale. A fresh source-local trace on 2026-09-22 found 79 idea rows across definition versions, but only one terminal done row at the currently selected digest sha256:e455eab1c6cfd3c85b1acf284000bb9f1f24b6051719d404b5797a4363d7360c. Older digests are not a comparable current baseline. This is insufficient evidence for a speed claim or immediate graph promotion. This task first obtains an idea-specific, attributable cohort under 0913's evidence rules; it may finish with a no-change/insufficient-evidence decision. The existing D62 promotion tool and registry own any candidate. Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md.

**Refine corrections (2026-09-22)**
- The previous Design only said to prefer coherent authoring → the current graph has a model-bearing feature-create state followed by a separate AC authoring state → the candidate stage/artifact and failure route are fixed below.
- The previous task implied an eligible idea optimization might already exist → 0912 has only one done idea row and no comparable candidate evidence → graph activation is conditional on the explicit cohort gate below.
- The whole-history idea count looked large enough to sample → the current selected graph has only one terminal done row → do not pool older digests to clear the candidate floor.

### Requirements

- [x] R1. Use an idea-specific baseline to determine whether consolidating feature-intent and AC authoring removes measurable redundant model work.
- [x] R2. Preserve verbatim intake and requirement coverage, feature structural checks, explicit design decisions and the corpus CLI write boundary.
- [x] R3. Preserve task dependency ordering, preparation digest validity and the single honest refineall/runall handoff.
- [x] R4. Use the established candidate deadline and real-evidence promotion process, with rejection/retirement if parity or benefit is unproven.

### Acceptance Criteria

- [x] AC1 — The selected change cites an idea-specific baseline and demonstrates its model-hop benefit on comparable real runs, or remains unpromoted. (req: R1)
- [x] AC2 — All input clauses reach the intended feature/task scope and invalid AC or unresolved design decisions prevent handoff. (req: R2)
- [x] AC3 — Dependency updates preserve valid preparation evidence and exactly one correct next-command handoff is emitted. (req: R3)
- [x] AC4 — Parity, failure-path coverage and candidate disposition are recorded with no standing parallel idea workflow. (req: R4)
- [x] AC5 — Planning preserves intent through handoff (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T03:20:55.189Z

Ready decision: the candidate is the feature-create AC draft plus deterministic validation and repair-only ac-generate path. The 0912 sample does not authorize activation. The coding agent first applies the fixed eligibility rule; if it fails, the task produces an explicit no-change disposition rather than inventing a benchmark. Any eligible candidate uses the existing D62 registry and a named deadline; 0917 is not a prerequisite.

### Design

Candidate only; no unconditional YAML edit. The current owner is config/workflows/idea-pipeline.yaml, with existing .spur/run/<runId>-idea-input.md, -idea-eval-report.md and -idea-ac-content.md artifacts. The feature-create planner call must continue creating/selecting a feature, writing feature id and Goal/Scope bodies, and may additionally write the existing -idea-ac-content.md as one coherent intent/AC draft. A deterministic AC-validation state persists that draft through spur feature update, runs the existing idea-ac-check and idea-coverage-check once, and routes PASS through the same feature-check/design/decompose decisions. Missing/empty/invalid draft routes to the existing ac-generate planner repair call; its capped retry path returns to the same validation state. The implementation may rename states to keep the graph legible but must preserve the existing artifact names, three-attempt cap, CLI write boundary and manual taste decisions. No new production YAML, public CLI surface, skill or duplicate validator.

First freeze an idea-specific source/installed cohort with workflow digest, execution mode, task/change class, terminal identity and mapped action durations. Eligibility to edit the graph is at least five real terminal idea runs, at least 80% mapped action coverage, and at least three successful new-feature planning runs whose feature-create and AC stages are timed separately. Reconcile stale rows; do not count them as terminals. If this floor is absent, record INSUFFICIENT_EVIDENCE, name the smallest real-run collection needed, and leave the graph unchanged. This is an accepted task outcome, not a delivered speed claim; report D63 R5 as still unverified to 0921 rather than closing it by assumption.

For an eligible cohort, register one candidate before changing the graph. Primary benefit: one fewer planner agent.run on a first-pass successful path. Freeze a net elapsed improvement threshold equal to at least half the baseline median AC-authoring stage duration, plus no loss of requirement coverage, no invalid AC handoff, no higher first-pass failure rate and no new taste-gate bypass. Name a calendar deadline within 14 days of candidate creation and resolve by that date. Replay proves route parity; comparable real candidate runs prove or disprove elapsed benefit. Unknown timing, tokens or cost remain unknown, never zero. Retire on insufficient evidence or a failed reliability floor. Project overrides remain untouched.

Primary tests belong in packages/app/tests/workflow/idea-pipeline-definition.test.ts and plugins/sp/tests/idea-coverage-check.test.ts; exercise omitted inventory items, invalid AC, existing-feature selection, rejected idea/design, dependency mutation and preparation digest. Update the dev-idea/dev-plan wrappers and owning spur-dev guidance only if the promoted behavior changes their contract. 0921 consumes the final candidate disposition; 0917's task-pipeline observation window is independent.

### Plan

- [x] 1. Rechecked current idea graph (digest e455eab1…) and 0912/0913 provenance; collected the idea-specific cohort (79 rows classified by digest/dry-run/terminal) and published exclusions, stage-timing coverage and the eligibility result in docs/reports/i31/0918-idea-cohort-eligibility.md. (R1)
- [x] 2. Eligibility floor failed on all three criteria → recorded INSUFFICIENT_EVIDENCE with the bounded missing-evidence experiment; no graph edit, no speed claim. (R1, R4)
- [x] 3. Collapsed by condition — eligible branch did not fire; graph, artifacts, caps, write boundary and taste gates left untouched. (R2, R3)
- [x] 4. Collapsed by condition — no candidate to promote or retire; existing definition/coverage suites re-run green; disposition handed to 0921. (R1–R4)

### Solution

- Cohort frozen from the main project run store (`.spur/spur.db`): 79 idea-pipeline rows; at the currently selected digest sha256:e455eab1… exactly 1 done row exists and it is synthetic fixture data (epoch≈2s timestamps, canned durations) — 0 real terminal runs (docs/reports/i31/0918-idea-cohort-eligibility.md:11).
- Eligibility floor (≥5 real terminals, ≥80% mapped action coverage, ≥3 timed new-feature planning runs) FAILS on all three criteria; older digests are not pooled per the refine Q&A (docs/reports/i31/0918-idea-cohort-eligibility.md:29).
- Disposition: INSUFFICIENT_EVIDENCE — idea-pipeline graph unchanged, no D62 candidate registered, no deadline opened; report published at docs/reports/i31/0918-idea-cohort-eligibility.md with the smallest real-run collection needed to re-evaluate (≥3 real new-feature intents at the current digest with feature-create/ac-generate stage timing + ≥1 further terminal run).
- Plan steps 3–4 collapsed by their own conditions (eligible branch did not fire); D63 R5 reported as still unverified to 0921.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Idea-specific baseline frozen and published: 79 rows classified by digest/dry-run/terminal (docs/reports/i31/0918-idea-cohort-eligibility.md:14-24); determination recorded — benefit not demonstrable at 0 real terminals; SQL re-run this session confirms 79 rows / 1 synthetic done at e455eab1. R1 does not demand a graph change; it demands the baseline-driven determination, which exists. |
| R2 | MET | config/workflows/idea-pipeline.yaml absent from git diff 9e874de17~1..9e874de17 (only report + task file); verbatim intake (.spur/run/<runId>-idea-input.md), idea-ac-check/idea-coverage-check, taste gates (idea-eval, feature-check, design-approval) and corpus CLI write boundary all untouched by definition; idea-pipeline-definition.test.ts re-run 41 pass / 0 fail. |
| R3 | MET | Graph untouched → task dependency ordering, ready-prepare preparation digest flow and the single handoff finalize path unchanged; same suite re-run green; `workflow show idea-pipeline --json` shows the unchanged e455eab1 graph with intact decompose → batch-create → batch-create-run → ready-prepare → handoff-finalize → handoff route. |
| R4 | MET | Candidate registration is preconditioned on the eligible branch ("For an eligible cohort, register one candidate before changing the graph"); branch did not fire. config/workflow-candidates.json candidates: [] and unmodified by 9e874de17 → no candidate, no deadline; disposition INSUFFICIENT_EVIDENCE recorded (report Decision §, task Solution). The retire/reject path is moot with nothing registered, and the promotion process itself was honored by not bypassing it. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

- D63 R5; 0912 baseline: docs/reports/i31/0912-workflow-baseline.md; 0913 evidence contract; ADR-107 and existing D62 promotion in docs/design/workflow-execution-economy.md.
- Current graph and validators: config/workflows/idea-pipeline.yaml; plugins/sp/scripts/idea-coverage-check.ts; packages/app/tests/workflow/idea-pipeline-definition.test.ts; plugins/sp/tests/idea-coverage-check.test.ts.
- Current-digest check on 2026-09-22: `workflow show idea-pipeline.yaml --format todo --json` selected sha256:e455eab1c6cfd3c85b1acf284000bb9f1f24b6051719d404b5797a4363d7360c; `workflow trace --workflow idea-pipeline --last 100 --json` returned 79 rows across digests but only one terminal done row for that digest.
- At refinement, only the clean /Users/robin/xprojects/spur-new-0915 worktree existed and no task was wip. Use a fresh isolated branch/worktree when implementation begins.

### History

- 2026-09-22T02:58:00.918Z todo → blocked (system)
- 2026-09-23T03:03:04.280Z blocked → todo (system)
- 2026-09-23T17:43:45.773Z todo → wip (system)
- 2026-09-23T17:56:20.472Z wip → testing (system)
- 2026-09-23T17:56:20.806Z testing → done (system)

