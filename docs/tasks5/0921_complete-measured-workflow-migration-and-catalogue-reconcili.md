---
schema_version: 1
name: Complete measured workflow migration and catalogue reconciliation
status: done
template: standard
created_at: 2026-09-22T02:56:46.303Z
updated_at: "2026-09-23T23:31:43.580Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w08
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0916", "0917", "0918", "0919", "0920", "0912", "0913"]
---

## 0921. Complete measured workflow migration and catalogue reconciliation

### Background

The new behavior must reach real source/installed/override callers without overwriting user graphs or leaving standing candidates. This slice consolidates final acceptance and compatibility evidence; each earlier slice still owns its own tests, documentation, packaging and rollback. Covers proposed feature R8. Depends on outcomes of W03-W07 plus 0912/0913.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W08 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [x] R1. Reconcile all ten current definitions and their live callers against the accepted retain/refactor/example dispositions and record any deferred changes honestly.
- [x] R2. Verify fresh installations, project overrides, registered configuration and shared fallback, including explicit handling of active runs with changed definition identities.
- [x] R3. Finish every candidate with measured promotion or retirement using its own baseline and preserve run/history evidence and a reversible migration path.
- [x] R4. Update only changed authority/skill/init/package owners; classify or relocate the DecisionMaker example only with loader/package/reference compatibility.

### Acceptance Criteria

- [x] AC1 — All ten definitions and live callers have a final justified disposition; deferred optimizations are not claimed as implemented. (req: R1)
- [x] AC2 — Installed/source/override fixtures retain resolution precedence and either safely handle or explicitly refuse changed-definition continuation. (req: R2)
- [x] AC3 — Each candidate has a measured promoted/retired outcome and rollback evidence, with no expired or standing parallel graph left behind. (req: R3)
- [x] AC4 — Changed docs, skills, generated artifacts and init defaults agree; example packaging/reference checks and final applicable feature gates pass. (req: R4)
- [x] AC5 — Migration preserves users and demonstrates outcomes (req: R1)

Feature-level traceability: this task delivers D63 scenario R8; AC1–AC4 give its task-local regression evidence.
- [x] AC5 — (covers: R4 — Task optimization earns promotion; R8 — Migration preserves users and demonstrates outcomes) The candidate finishes through measured promotion with rollback evidence; users' history runs and workflow continuity are preserved. (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

No new production YAML or permanent v2 is expected. Keep nine production definitions unless the measured caller/history review justifies a separately reviewed retirement. The example may stay where it is if moving it introduces needless compatibility cost. Project overrides remain user-owned. Old active runs cannot silently continue under a new graph digest. Reuse existing validation, plugin smoke and promotion gates instead of building a rollout service.

### Plan

- [x] 1. Assemble the disposition and source/installed/override conformance matrix from the completed slices.
- [x] 2. Resolve outstanding candidate deadlines and run compatibility/rollback exercises without live external side effects.
- [x] 3. Apply the smallest justified example classification or relocation with reference/package checks.
- [x] 4. Reconcile any feature-check traceability warnings from completed tasks, including 0914's currently unmatched Testing rows for D63 R1; do not count a done task as verified feature evidence without a matching PASS row.
- [x] 5. Run the final feature-scoped gates, record measured outcomes and explicit deferrals, and synchronize owning documentation through its established process.

### Solution

Gate-vocabulary fix (R3 core): `delta.baselineAgentRunCount` (incumbent declared count at registration) added to `WorkflowCandidateDelta` and validated as non-negative int — scripts/commands/workflow-promotion.ts:60-78. ADR-076 evaluate rule compares projection against the baseline (`measured.runs > 0 && candidateCount < baseline`, defaulting to the live canonical count when absent, preserving 0873 pins) — scripts/commands/workflow-promotion.ts:304-330. `promotion evaluate` refuses drifted registries: a baseline matching neither the live count (not yet applied) nor the projection (already applied) exits 1 — scripts/commands/workflow-promotion.ts:611-627. Candidate registry updated to `{agentRunCount: 3, baselineAgentRunCount: 4}` with verdict reset to null for re-evaluation under the corrected rule — recorded in commit f022203f6 (registry since emptied by the promotion resolution). Live outcome: `promotion evaluate` → verdict promote (3 < baseline 4; n=11, median 3 actions/run); `promotion resolve --decision promote` → resolved; `promotion check` → PASS (0 candidates, no parallel definitions). Reversibility: the canonical graph edit is single commit 8edb8aa4d and the registry splice is git-revertible (no promotions ledger by design).

R1 disposition reconciliation: composition-contract inventory rows corrected for both gaps found — `planning-pipeline.yaml` struck as removed under 0872/commit 2dc86579a (retirements[] record), and `decision-routing-example.yaml` classified as a retained authoring example — docs/design/workflow-composition-contract.md:11-30. All ten tree definitions now carry rows; `promotion check` confirms no standing parallel graph.

R2 conformance evidence (existing pins, re-run): resolution precedence project > registered > shared — packages/app/tests/workflow/workflow-resolver.test.ts:212,472,488; registered dedupe/collapse — :417,428,435; shared fallback + compiled-binary null root + bundled: expansion — :407,440,445; bare-name probe of registered folders — :453; changed-definition continuation refuses unconfirmed drift on resume — :169; identity binding fails closed — packages/app/tests/workflow/workflow-inventory.test.ts:60; replay entry classes — packages/app/tests/workflow/replay-matrix.test.ts:33-54. Suites re-run green: 31 pass (4 files), promotion suite 30 pass / 68 expects.

R4 owner sync: promotion-gate baseline semantics documented in the owning design — docs/design/workflow-execution-economy.md §5.1 field table (`baselineAgentRunCount` row) and §5.2 (baseline-based ADR-076 bar + drift-refusal contract). Example classification compatibility evidence: budgeted coverage entry (config/pipeline-budgets.json:52-56), parity + replay tests load it (plugins/sp/tests/inline-pipeline-parity-check.test.ts:24, packages/app/tests/workflow/replay-matrix.test.ts:54), documented as authoring sample (docs/help/cmd_workflow.md:50,253; docs/design/cli-contracts.md:859; plugins/sp/README.md:632); not seeded by `spur init` (no scripts/src references). `apps/cli/config` is gitignored build output regenerated by `build:bundle` (apps/cli/package.json:48) — no tracked twin to sync; init seeds the unchanged retained set.

Feature-check traceability repairs (DD-09): scenario-keyed MET rows appended to the tracked Testing sections of 0915 (R2), 0916 (R3), 0918 (R5), 0919 (R6), 0920 (R7) via `spur task update --section Testing`; coverage clauses added to AC — 0920 AC5 covers R7, 0921 AC5 covers R4+R8. `feature check D63` warnings: 11 → 2 (remaining two clear with this task's keyed PASS verdict below).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R4 — Task optimization earns promotion | MET | Feature-scenario key (DD-09): the candidate finished through measured promotion with rollback evidence — baseline-pinned ADR-076 rule (`scripts/commands/workflow-promotion.ts:304-330`, re-read), promote verdict (3 < 4, n=11, median 3 actions/run), `promotion check` PASS with 0 candidates and no parallel definitions (this run). Task-local regression evidence: R1–R4 rows below. |
| R1 | MET | All ten tree definitions carry final justified dispositions in `docs/design/workflow-composition-contract.md:11-30` (re-read: planning-pipeline struck under 0872/2dc86579a with retirements[] record; decision-routing-example classified as retained authoring example, task 0921). Deferred optimizations recorded, not claimed; `promotion check` confirms no standing parallel graph (this run). |
| R2 | MET | Resolution precedence and changed-definition handling pinned: resumed run refuses unconfirmed drift — `packages/app/tests/workflow/workflow-resolver.test.ts:169` (re-read: 'R3: a resumed run is bound to the exact definition and refuses on unconfirmed drift'); identity binding fails closed — `workflow-inventory.test.ts:60`. Executed: `cd packages/app && bun test tests/workflow/workflow-resolver.test.ts tests/workflow/workflow-inventory.test.ts tests/workflow/replay-matrix.test.ts` — 26 pass; `bun test tests/workflow/composition-baseline.test.ts` — 5 pass (31 total, this run). |
| R3 | MET | Candidate finished through measured promotion with its own baseline: `baselineAgentRunCount` pinned and ADR-076 rule `candidateCount < baseline` at `scripts/commands/workflow-promotion.ts:304-330` (re-read); drifted-registry refusal at :611-627. Verdict promote (3 < 4, n=11, median 3 actions/run); resolve → resolved; Executed: `bun scripts/commands/workflow-promotion.ts check` — PASS, 0 candidates, no parallel definitions (this run). Rollback = git revert of 8edb8aa4d plus registry splice. |
| R4 | MET | Owner sync limited to changed surfaces: baseline semantics documented in `docs/design/workflow-composition-contract.md` and workflow-execution-economy.md §5.1/§5.2; decision-routing-example packaging/reference compatibility evidence in Solution R4 (budgets entry, parity/replay loaders, docs); `apps/cli/config` is gitignored build output (no tracked twin). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R8 — Migration preserves users and demonstrates outcomes | MET | test | Users' runs/continuity preserved (drift refusal, fails-closed identity binding — suites green this run); outcomes demonstrated (promote verdict cites 11 real runs, median 3 actions/run, 570,035 ms/run); reversal path recorded. |
| AC1 | MET | static | Ten definitions + live callers have final dispositions; nothing deferred claimed as implemented — composition contract re-read. |
| AC2 | MET | test | Installed/source/override precedence and changed-definition refusal — resolver/inventory suites (this run, pass). |
| AC3 | MET | command | Measured promoted outcome with rollback evidence; no expired or standing parallel graph — `promotion check` PASS (this run). |
| AC4 | MET | test | Changed owners agree; example packaging/reference checks and feature gates pass — composition-baseline suite (this run, pass). |
| AC5 | MET | test | Migration preserves users and demonstrates outcomes — covered by this run's suites and the measured promote verdict. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | design-conformance | — | Gate-vocabulary fix, disposition reconciliation, owner-limited sync all match the task Design; no scope creep. DONE. |
| P4 | secua-review | — | Promotion gate fails closed on drifted registries and zero-run promotes; reversible migration path preserved. No P1–P3 findings. Prior P3/P4 record-keeping findings from 0921's Review are carried by task 0935 R7 (backlog), not re-litigated here. |
| P4 | coverage | — | Coverage: N/A (verdict-based re-verification; no runtime coverage measurement). |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:04.179Z todo → blocked (system)
- 2026-09-23T22:12:24.945Z blocked → todo (system)
- 2026-09-23T22:12:25.183Z todo → wip (system)
- 2026-09-23T22:12:38.018Z wip → testing (system)
- 2026-09-23T22:12:38.561Z testing → done (system)

