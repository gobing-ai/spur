---
schema_version: 1
name: Reconcile the workflow catalogue with keep, fix or retire decisions
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.007Z
updated_at: "2026-09-26T02:40:22.000Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - catalogue

dependencies: ["0938", "0943", "0944", "0945"]
estimate_hours: 5
---

## 0946. Reconcile the workflow catalogue with keep, fix or retire decisions

### Background

Implements: R10 — Catalogue workflows are kept, fixed or retired on evidence. docs/design/workflow-catalogue-refactor.md §8. Initial suspects: pr-review, wayfinder, decision-routing-example.

**Refine corrections (2026-09-23)**

1. *Catalogue and wayfinder name.* `config/workflows/` holds ten definitions:
   - decision-routing-example
   - feature-lifecycle
   - feature-verification
   - history-anatomy
   - idea-pipeline
   - pr-review
   - task-lifecycle
   - task-pipeline
   - wayfinder-resolution
   - wrapup-pipeline

   The suspect "wayfinder" is `wayfinder-resolution`.
2. *Retirement machinery exists.* `config/workflow-candidates.json` already carries `retirements[]` records (`{name, recordedBy, date, rationale}`, for example planning-pipeline and task-pipeline2). `bun scripts/spur-dev.ts promotion` fails on `unrecorded-retirement` and `parallel-definition` (`scripts/commands/workflow-promotion.ts:124`). A retirement is a YAML delete **plus** a retirement record, not a free-form edit.
3. *Caller surface per suspect*, non-test references under plugins, apps/cli/src, packages/app/src and scripts:
   - `pr-review`: about 10;
   - `wayfinder-resolution`: about 4;
   - `decision-routing-example`: only `plugins/sp/README.md` among those. It is also referenced from `config/pipeline-budgets.json`, `docs/design/workflow-composition-contract.md` and `docs/design/cli-contracts.md`.
4. *History-anatomy graph decision.* This moved here from 0944, which is measurement-only.
5. *Bookkeeping workflows.* `task-lifecycle` and `feature-lifecycle` (0937 `BOOKKEEPING_WORKFLOWS`) are exempt from cost-based retirement. They are judged on correctness only.

### Requirements

- [x] R1. A decision table is added as §10 "Catalogue reconciliation" of `docs/design/workflow-catalogue-refactor.md`. It has one row per workflow (all ten), and each row gives:
  - the `keep | fix | retire` decision;
  - evidence: 0938 run count since 2026-06-01, `agent.run` median, wall p50/p90 and terminal-reason mix;
  - live caller count;
  - a one-line reason.

  Bookkeeping workflows are judged on correctness, not cost. `history-anatomy` cites the 0944 measurement.
- [x] R2. Every `retire` deletes the YAML under `config/workflows/`, reroutes or removes every caller (plugin commands/skills/README, `config/pipeline-budgets.json`, design-doc mentions) and appends a `retirements[]` record. It then regenerates `apps/cli/config/` via `bun run --filter @gobing-ai/spur build:bundle` and updates the composition, guard-parity and catalog-parity baselines. `bun scripts/spur-dev.ts promotion` passes.
- [x] R3. Every `fix` becomes a follow-up task under feature D64 via `spur task create`, with the evidence row cited in its Background. This task does not implement fixes.
- [x] R4. The decision rule is applied mechanically. `retire` requires zero real (non-dry, non-bookkeeping) runs in the window **and** either no live caller or an example-only role. A workflow with fewer than 3 runs but live callers is `keep` with a follow-up measurement note, never a retirement.

### Acceptance Criteria

- [x] AC1 — Catalogue workflows are kept, fixed or retired on evidence

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:59.335Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:29:37.438Z

**Refine decisions — 2026-09-23 (ready depth)**

- **The mechanical retire rule is zero real runs AND (no live caller OR example-only).** This makes decisions reproducible and prevents cost-only retirement of a live surface.
- **Bookkeeping workflows are judged on correctness only.** Their run counts are lifecycle transitions, not work.
- **This task owns the history-anatomy graph decision.** It moved from 0944.
- **`spur-check-feature` runs here once.** This is the last D64 task.
- **Estimate: 5h.**

### Design

**Approach.** Take evidence first, then apply one mechanical rule, then delete (ADR-076 "delete, don't layer"). The rule in R4 makes decisions reproducible from the 0938 report and the caller grep. The table lives in the D64 satellite as the durable record; the task holds only execution evidence.

**Frozen names:**
- section `§10 Catalogue reconciliation`;
- retirement records use the existing `{name, recordedBy: "0946 (D64)", date, rationale}` shape.

**Invariants:**
- No caller points at a deleted definition. A test or grep asserts zero references outside `retirements[]` and history docs.
- Bundle regenerated.
- `promotion` check green.
- Historical run rows are retained, never deleted.

**Rejected alternatives:**
- Deprecation shims kept indefinitely.
- Retiring on cost alone while live callers exist.
- Retiring bookkeeping workflows on cost.

**Anti-patterns:**
- Editing `drizzle/_legacy_reference/`.
- Deleting run history.
- Implementing `fix` items here.

**Expected outcome (hypothesis, not a decision):**
- `decision-routing-example` is likely `retire`: it is example-only, with only README, budget and doc references.
- `pr-review` and `wayfinder-resolution` depend on the measured runs.

### Plan

1. Run `bun scripts/spur-dev.ts real-run-cost --by-state --json --since 2026-06-01` (0938) and a caller grep per workflow. Save both as evidence in the Solution section.
2. Apply the R4 rule and write §10 of the design satellite.
3. For each `retire`: delete the YAML, reroute or remove callers, append a `retirements[]` record, run `build:bundle`, and update the baselines. Run `bun scripts/spur-dev.ts promotion`.
4. For each `fix`, run `spur task create` under D64 with an evidence citation and dependencies.
5. Run `bun run spur-check`, then `bun run spur-check-feature` (the feature-scoped repo-wide pass at feature close, ADR-119).

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:317` |
| `packages/app/src/index.ts:321` |
| `packages/app/src/index.ts:733` |
| `packages/app/src/index.ts:764` |
| `packages/app/src/index.ts:918` |
| `packages/app/src/services/inline-run-setup.ts:311` |
| `packages/app/src/services/inline-run-setup.ts:33` |
| `packages/app/src/services/inline-run-setup.ts:43` |
| `packages/app/src/services/workflow-service.ts:1913` |
| `packages/app/src/services/workflow-service.ts:1949` |
| `packages/app/src/services/workflow-service.ts:2201` |
| `packages/app/src/services/workflow-service.ts:2746` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:51` |
| `packages/app/src/services/workflow-service.ts:65` |
| `packages/app/src/services/workflow-service.ts:69` |
| `packages/app/src/services/workflow-service.ts:699` |
| `packages/app/src/services/workflow-service.ts:78` |
| `packages/app/src/services/workflow-service.ts:802` |
| `packages/app/src/services/workflow-service.ts:81` |
| `packages/app/src/services/workflow-service.ts:963` |
| `packages/app/src/services/workflow-service.ts:971` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/actions/agent-run.ts:1292` |
| `packages/app/src/workflow/actions/agent-run.ts:195` |
| `packages/app/src/workflow/actions/agent-run.ts:206` |
| `packages/app/src/workflow/actions/agent-run.ts:241` |
| `packages/app/src/workflow/actions/agent-run.ts:246` |
| `packages/app/src/workflow/actions/agent-run.ts:257` |
| `packages/app/src/workflow/actions/agent-run.ts:30` |
| `packages/app/src/workflow/actions/agent-run.ts:407` |
| `packages/app/src/workflow/actions/agent-run.ts:645` |
| `packages/app/src/workflow/builtins.ts:104` |
| `packages/app/src/workflow/builtins.ts:14` |
| `packages/app/src/workflow/builtins.ts:2` |
| `packages/app/src/workflow/builtins.ts:29` |
| `packages/app/src/workflow/builtins.ts:57` |
| `packages/app/src/workflow/builtins.ts:74` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/app/tests/services/inline-run-setup.test.ts:15` |
| `packages/app/tests/services/inline-run-setup.test.ts:3` |
| `packages/app/tests/services/inline-run-setup.test.ts:649` |
| `packages/app/tests/services/workflow-service.test.ts:278` |
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/app/tests/workflow/guard-parity.test.ts:59` |
| `packages/app/tests/workflow/guard-parity.test.ts:91` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:648` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:13` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:49` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:57` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:71` |
| `packages/app/tests/workflow/replay-matrix.test.ts:53` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:109` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:113` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:115` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:117` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:123` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:128` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:81` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:102` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:129` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:136` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:162` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:210` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:213` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:23` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:352` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:360` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:368` |
| `packages/config/src/index.ts:771` |
| `packages/config/src/loader.ts:299` |
| `packages/config/tests/loader.test.ts:1112` |
| `packages/config/tests/loader.test.ts:30` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:47` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:52` |
| `plugins/sp/scripts/inline-run-setup.ts:103` |
| `plugins/sp/scripts/inline-run-setup.ts:318` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:347` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:430` |
| `plugins/sp/scripts/inline-run-setup.ts:465` |
| `plugins/sp/scripts/inline-run-setup.ts:48` |
| `plugins/sp/scripts/inline-run-setup.ts:557` |
| `plugins/sp/scripts/inline-run-setup.ts:562` |
| `plugins/sp/scripts/inline-run-setup.ts:575` |
| `plugins/sp/scripts/inline-run-setup.ts:580` |
| `plugins/sp/scripts/inline-run-setup.ts:596` |
| `plugins/sp/scripts/inline-run-setup.ts:612` |
| `plugins/sp/scripts/inline-run-setup.ts:629` |
| `plugins/sp/scripts/quality-gate.ts:107` |
| `plugins/sp/scripts/quality-gate.ts:16` |
| `plugins/sp/scripts/quality-gate.ts:185` |
| `plugins/sp/scripts/quality-gate.ts:29` |
| `plugins/sp/scripts/quality-gate.ts:547` |
| `plugins/sp/scripts/quality-gate.ts:552` |
| `plugins/sp/scripts/quality-gate.ts:568` |
| `plugins/sp/scripts/quality-gate.ts:625` |
| `plugins/sp/scripts/quality-gate.ts:656` |
| `plugins/sp/scripts/quality-gate.ts:658` |
| `plugins/sp/scripts/quality-gate.ts:660` |
| `plugins/sp/scripts/quality-gate.ts:668` |
| `plugins/sp/scripts/quality-gate.ts:90` |
| `plugins/sp/scripts/wrapup-steps.ts:12` |
| `plugins/sp/scripts/wrapup-steps.ts:189` |
| `plugins/sp/scripts/wrapup-steps.ts:535` |
| `plugins/sp/scripts/wrapup-steps.ts:540` |
| `plugins/sp/scripts/wrapup-steps.ts:6` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:222` |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:18` |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:22` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `plugins/sp/tests/skill-structure.test.ts:799` |
| `plugins/sp/tests/wrapup-steps.test.ts:488` |
| `plugins/sp/tests/wrapup-steps.test.ts:6` |
| `scripts/commands/bundle-plugin-lib.ts:129` |
| `scripts/commands/bundle-plugin-lib.ts:176` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:119` |
| `scripts/commands/real-run-cost.ts:129` |
| `scripts/commands/real-run-cost.ts:173` |
| `scripts/commands/real-run-cost.ts:179` |
| `scripts/commands/real-run-cost.ts:183` |
| `scripts/commands/real-run-cost.ts:196` |
| `scripts/commands/real-run-cost.ts:214` |
| `scripts/commands/real-run-cost.ts:245` |
| `scripts/commands/real-run-cost.ts:256` |
| `scripts/commands/real-run-cost.ts:274` |
| `scripts/commands/real-run-cost.ts:293` |
| `scripts/commands/real-run-cost.ts:319` |
| `scripts/commands/real-run-cost.ts:330` |
| `scripts/commands/real-run-cost.ts:35` |
| `scripts/commands/real-run-cost.ts:42` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:501` |
| `scripts/commands/real-run-cost.ts:506` |
| `scripts/commands/real-run-cost.ts:516` |
| `scripts/commands/real-run-cost.ts:532` |
| `scripts/commands/real-run-cost.ts:534` |
| `scripts/commands/real-run-cost.ts:57` |
| `scripts/commands/real-run-cost.ts:90` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | §10 'Catalogue reconciliation' at docs/design/workflow-catalogue-refactor.md:168-196: exactly 10 rows, one per pre-existing workflow; each with decision keep\|fix\|retire, evidence (0938-window run count, agent.run median, wall p50/p90, terminal-reason mix), live caller count, reason. Bookkeeping (task-lifecycle:179, feature-lifecycle:180) correctness-judged 'cost-exempt'; history-anatomy (:184-186) cites 0944 receipt/finding F3. |
| R2 | MET | config/workflows/decision-routing-example.yaml deleted (sole 'D' in tree). Zero live callers (grep: only retirements[] record, README note plugins/sp/README.md:635-637, fixture+test, design/help docs, code comment). retirements[] frozen shape exact at config/workflow-candidates.json:84-88. apps/cli/config/workflows/ = 9 YAMLs, none decision-routing-example. Fresh 'promotion check' PASS (4 candidates, no parallel defs). |
| R3 | MET | No new docs/tasks5/ files attributable to 0946 (0947-0953 pre-exist, committed 2b8e5601a; worker made no commits). Zero fix decisions in §10 (:194-196); fix-shaped gaps owned by 0940/0943/0944/0945 candidates. |
| R4 | MET | Independently recomputed from .spur/run/0946-real-run-cost.json + fresh sqlite ro probe: decision-routing-example only retire (0 real runs ever, example-only, no live caller). All 9 keeps rule-consistent (task-pipeline 9 runs/~30 callers; six 0-run workflows each have live callers 3-46; bookkeeping exempt). Live drift: task-pipeline 10 vs snapshot 9 — declared point-in-time; retire rests on 0-ever. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Catalogue workflows are kept, fixed or retired on evidence | MET | test | workflow validate valid ×9; workflow-catalog-parity.test.ts 1 pass/0 fail; inline-pipeline-parity-check ok (11 actions, 4 guards agree across 9 workflows); spur-check PASS 9176/0 and spur-check-feature PASS recorded in implement-0946-worker.md gates table (review re-ran both fresh). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: **PASS** (full review run 2b259220, single pass — no post-review code mutations, so no delta re-review). Functional traceability R1–R4 + AC1 all **MET**; all gates re-run fresh by the reviewer.

| P | Finding | Disposition |
|---|---------|-------------|
| P4×4 | (1) 9178→9176 test-delta not attributable to deleted `test()` declarations (replay-matrix is 4 fixed blocks) — substance holds, fresh spur-check 9176 pass / 0 fail is the operative evidence; (2) fixture YAML "unchanged" only vs 0946-session tree, not base-era (carries 0941 classify state); (3) evidence snapshot is point-in-time — live runs table already drifted (task-pipeline 10 vs 9), retire decision unaffected (0 rows ever, independently probed); (4) pre-existing `docs/help/cmd_workflow.md:256` staleness listing 0866 retirees | All ACCEPTED as notes; no code changes. (1) batch report states "9176 pass / 0 fail" without attribution. (4) rides the next doc-evolve pass. |

Adjudications: `hitl.select` removal is documentation/mirror-side only (`inline-pipeline-parity-check.ts:48`, `inline-pipeline-driver.md:26`) — app-side union untouched (`builtins.ts:21`), no dangling refs. §10 discloses the run-record vs phase-plane evidence split (wayfinder phase-plane `done`=1; history-anatomy 7 pre-0925 rows) rather than claiming flat zero. `--include-bookkeeping` was delivered by 0938 per its own spec R3 and is a reporting filter on the sanctioned internal surface. R3 vacuously MET: zero fix decisions, no duplicate scope vs 0940/0943/0944/0945 (all four candidate ids confirmed live).

Residual risks: cmd_workflow.md 0866-table staleness (pre-existing); runs-plane drift past the snapshot is by-design for point-in-time evidence.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T22:04:40.491Z todo → wip (system)
- 2026-09-25T22:51:09.888Z wip → testing (system)
- 2026-09-25T22:51:16.460Z testing → done (system)

