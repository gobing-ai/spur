---
schema_version: 1
name: "Classify shipped workflows by fit and select surrounding pilots"
status: done
template: meta
created_at: 2026-09-02T03:05:58.076Z
updated_at: "2026-09-02T17:49:59.671Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "fit", "pilot"]
dependencies: ["0729", "0730"]
---

## 0731. Classify shipped workflows by fit and select surrounding pilots

### Background

D8 follows the operator's surrounding-workflows-first rule. Audit the full shipped workflow inventory against the existing replay + machine branch + durable record fit gate, actual callers, and observed usage before selecting any pilot. The canonical task pipeline is explicitly not the pilot.

### Requirements

- [x] R1. Independently freeze all 11 repository workflow YAML files and separately inventory bundled, installed, and project-local definitions. Record source-local binary/importer, absolute resolved path/layer, definition digest, optional version state, and full validation result; do not equate `list.valid` or baseline membership with validity.
- [x] R2. For every definition, identify actual callers and deployment role—canonical engine pipeline, lifecycle, orchestrator, example/fixture, or unused—and trace engine run/continue, prompt-level inline execution, lifecycle, and progress-projection paths where applicable.
- [x] R3. Record graph facts: states, actions, deterministic/model hops, branches, loops/bounds, pauses, failure terminals, artifacts, composition findings, dry-run behavior, real-run frequency/outcomes, and known prerequisite defects. Unknown evidence stays unknown.
- [x] R4. Apply the existing replay + machine branch + durable record fit gate and assign keep, simplify/optimize, demote-to-procedure/fixture, or retire with confidence. Identify duplicated orchestration, unconditional stages, redundant probes, overlarge bounds, ownership breaches, and inline-engine parity cost before proposing infrastructure.
- [x] R5. Build a prerequisite table for each candidate. A workflow cannot be an executable pilot while it relies on an unrepaired timeout, confinement, proof/freshness, nested-run, validation/resolution, or continue defect; `feature-dev` remains ineligible while its nested review is impossible.
- [x] R6. Rank one or two real-caller surrounding pilots by representativeness, reversibility, trace coverage, prerequisite readiness, and blast radius. Exclude `task-pipeline` and definitions without a proven caller from pilot selection.
- [x] R7. Classify version only as `unversioned` or `explicit(<literal>)`, reflecting the current behavior-neutral optional string. Identify which eligible pilot can exercise both forms and the source/digest/resume implications; do not invent unsupported-version semantics or a registry.
- [x] R8. Record the compact workflow matrix, dispositions, prerequisite table, and pilot recommendation in the Solution without changing production definitions or public CLI surfaces.
- [x] R9. Publish the durable findings artifact at `docs/inventory/d8-0731-workflow-fit-classification.md` — fit/deployment-role matrix and the pilot recommendation. The task Solution summarizes and links it; the artifact is the reviewable deliverable.

### Acceptance Criteria

- [ ] All 11 repository workflows and any shadowing bundled/installed/project-local definitions are accounted for independently of the composition baseline.
- [ ] Every workflow has an evidence-grounded caller/deployment role, fit verdict, target disposition, version state, and confidence; absent optional `version` is valid and reported as unversioned.
- [ ] Run and continue paths, configured and bundled resolution, inline execution, lifecycle, projection, and dry-run limits are represented where they affect a workflow.
- [ ] Deletion, retirement, or demotion opportunities are evaluated before optimization or new infrastructure.
- [ ] Each pilot has a closed prerequisite table and a proven real caller; no known-broken primitive is treated as safety or observability evidence.
- [ ] `feature-dev` is ineligible while nested review is impossible, no-caller definitions are not pilots, and `task-pipeline` is excluded.
- [ ] No production workflow or public CLI surface changes occur in this ticket.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use a single sortable matrix sourced from explicit files, callers, validation, graph output, and traces. Apply the existing fit gate before scoring pilots, then subtract candidates with unresolved correctness prerequisites. Prefer retirement/demotion over making an unused definition more sophisticated.

### Plan

- [ ] Load 0729 and 0730 outputs and freeze all definition sources and callers.
- [ ] Validate each explicit file and extract graph, trace, execution-surface, and version facts.
- [ ] Apply deployment-role and fit dispositions, including retire/demote candidates.
- [ ] Attach correctness prerequisites and exclude ineligible/no-caller candidates.
- [ ] Rank one or two surrounding pilots and record the compact matrix and recommendation.
- [ ] Publish `docs/inventory/d8-0731-workflow-fit-classification.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Durable deliverable (R9): **`docs/inventory/d8-0731-workflow-fit-classification.md`** — the reviewable artifact. No production workflow definition or public CLI surface was changed (AC). Full evidence and matrices live in the artifact; this section summarizes and links it with `file:line` anchors.

- **R1 freeze** — all 11 repo workflows frozen; no shadowing bundled/installed/project-local surface participates (`apps/cli/config/workflows/` and `.spur/workflows/` absent; installed copies byte-identical to repo, `diff -q SAME`). Source-local binary `bun run apps/cli/src/index.ts`; resolved layer `project` → installed `.../config/workflows`. Live `definitionDigest` per run matches 0730 §A. Version state: **all 11 unversioned**. Baseline membership ≠ validity: all 11 `workflow validate` valid; composition baseline holds 8 (missing feature-lifecycle/history-anatomy/task-lifecycle) with stale digests. See artifact §1 (`docs/inventory/d8-0731-workflow-fit-classification.md:9`).
- **R2 callers** — real-caller evidence traced from code wiring (`task.ts:439,1528`, `feature.ts:556`, `make-lifecycle-adapter.ts`, `lifecycle-adapter.ts:47,55`), plugin commands/skills, `task_run_links` (10 rows), `queue_jobs`. Proven real callers: task-lifecycle, feature-lifecycle (lifecycle `requestTransition`), wrapup-pipeline (`/sp:dev-wrap`/`dev-wrapall` → `workflow run`), idea-pipeline, task-pipeline (canonical, excluded per R6). No proven `workflow run` caller: docs-pipeline, history-anatomy, pr-review (SSOT/fixture), basic (example), wayfinder-resolution (unused). feature-dev intended but structurally blocked. See artifact §2 (`:33`).
- **R3 graph facts** — states/actions/model-hops/branches/loops/pauses/failure-terminals/artifacts/composition/dry-run/real-run for all 11 (unknowns stay `?`). Dry-run executes real guard shells (probe-verified); only wrapup-pipeline reaches dry `done`. Real-run frequency: **0 terminal runs for all 11** (68 runs = 65 dry + 3 lifecycle bookkeeping). See artifact §3 (`:57`).
- **R4 fit gate + dispositions** — replay + machine branch + durable record: **keep** = task-lifecycle, feature-lifecycle, wrapup-pipeline, history-anatomy (caller unproven); **simplify-optimize** = task-pipeline (14 advisories), idea-pipeline (9); **keep-as-example** = basic; **demote-to-procedure-or-fixture** = pr-review, docs-pipeline, wayfinder-resolution; **keep-with-defect/ineligible** = feature-dev. Retire: none this pass (no production change; wayfinder/basic retirement deferred to 0732/0733). Duplicated orchestration/unconditional stages/redundant probes/overlarge bounds/ownership breach (feature-dev nested pr-review, 0729 §F-2)/inline-engine parity cost all evaluated. See artifact §4 (`:81`).
- **R5 prerequisites** — closed table per candidate against 0729 §F register. wrapup-pipeline and task-lifecycle are **READY** (non-pause path / status-graph); feature-dev **INELIGIBLE** (nested review impossible, F2); pr-review **NOT READY** (superskill staging unknown + F2-linked); idea-pipeline partial (F4 on pause), not selected. See artifact §5 (`:112`).
- **R6 pilot ranking** — eligible real-caller surrounding workflows ranked (representativeness/reversibility/trace coverage/prereq-ready/blast radius): **#1 wrapup-pipeline** (primary — real `workflow run` caller, dry `done`, reversible, low blast), **#2 task-lifecycle** (secondary — minimal real-caller FSM, cleanest version-both-forms vehicle). `task-pipeline` excluded; no-caller defs not pilots. See artifact §6 (`:132`, recommendation `:143`).
- **R7 version** — all 11 `unversioned`; `explicit(<literal>)` only for non-empty literal; zero consumers; version-only edit changes digest (`computeDefinitionDigest`, `composition-baseline.ts:110-116`, empirically verified); continue ignores drift (0729 §F-4) so a version edit between run/resume is invisible. Both-forms exercise: task-lifecycle. See artifact §7 (`:153`).
- **R8/R9** — compact matrix + disposition summary + recommendation published in the artifact; this Solution links it. See artifact §8 (`:162`).

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All 11 `config/workflows/*.yaml` present; `apps/cli/config/workflows/` and `.spur/workflows/` absent (no shadowing surface, `ls` verified). Installed copies byte-identical to repo (3 spot-checked this run `diff -q SAME`: task-lifecycle, idea-pipeline, wrapup-pipeline; review verified ×11). All 11 `definitionDigest` values re-read live from `runs.metadata_json` this run — match §1 exactly (basic `9d7723a9…`, docs-pipeline `ee5c8858…`, feature-dev `6d4b7535…`, feature-lifecycle `9f119639…`, history-anatomy `a898d445…`, idea-pipeline `d33fb1a6…`, pr-review `eb3f5187…`, task-lifecycle `fb5b8639…`, task-pipeline `b3b82966…`, wayfinder-resolution `1b1ba738…`, wrapup-pipeline `3d8e8964…`). Baseline holds 8 (`config/workflow-composition-baseline.json` keys = docs-pipeline/idea-pipeline/task-pipeline/wrapup-pipeline/pr-review/basic/feature-dev/wayfinder-resolution — missing feature-lifecycle/history-anatomy/task-lifecycle, verified). All 11 `unversioned`; schema `required: ['name','initialState','states','transitions']` + optional `version` (review-verified). |
| R2 | MET | Caller/deployment-role anchors re-verified this run: `task.ts:439,1528` (`makeLifecycleAdapter(…TASK_LIFECYCLE_PROFILE)`), `feature.ts:556` (`FEATURE_LIFECYCLE_PROFILE`), `make-lifecycle-adapter.ts:3`; `dev-wrap.md:31,45` + `dev-wrapall.md:33,47` (`spur workflow run wrapup-pipeline.yaml` only implementation); `dev-idea.md:45-46` + `dev-plan.md:46-47` (idea-pipeline inline/async); `dev-run.md:66-67` + `dev-runall.md:52,69` (task-pipeline). `task_run_links` = **10** rows (verified live); 0539 = **5** dry probes; queue_jobs = scheduler-only (`system-events-prune`, `smoke`, `history.refresh`). |
| R3 | MET | Graph facts re-derived from live YAML/DB: idea-pipeline pause count = **4** (see Finding 1 verification — YAML `pause: true` at lines 123/219/277/334 only; 500/550 comments). wrapup-pipeline dry `done` = **6** runs (DB-verified). Cohort = 68 total = 65 dry (`metadata_json` contains `dryRun":true`) + 3 non-terminal (`metadata_json={}`: `run_618bd87b` feature-lifecycle, `run_ea369461`+`run_cdae9c31` task-lifecycle). Zero real terminal runs. feature-lifecycle dry-run honestly `?` (not probed). |
| R4 | MET | Fit-gate dispositions internally coherent; feature-dev nested-review F-2 re-verified (`config/workflows/feature-dev.yaml:156-169`: `command.gate` → `spur workflow run .spur/workflows/pr-review.yaml`, `softFail:true`, `timeoutMs:1800000`). Retire evaluated-then-deferred (wayfinder/basic → 0732/0733) consistent with AC (no production change). Git status shows **no** `config/workflows/`, `apps/cli/schemas/`, or `packages/app/src/workflow/` modifications. |
| R5 | MET | Closed prerequisite table coherent per candidate; lifecycle provenance gate re-read at `packages/app/src/workflow/lifecycle-adapter.ts:100-130` (`kind=pipeline` link or `provenance_bypass`/`SPUR_PROVENANCE_OVERRIDE=1` for task `done`). wrapup-pipeline READY non-pause path, feature-dev INELIGIBLE (F-2), pr-review NOT READY (superskill staging unknown), idea-pipeline not-selected (F4 on pause) — all consistent with 0729 §F register. |
| R6 | MET | Exclusion logic follows R6 as written: task-pipeline excluded (canonical), 5 no-caller defs not pilots, feature-dev ineligible. Ranking (#1 wrapup-pipeline, #2 task-lifecycle) verified against evidence — wrapup is the only eligible real-caller `workflow run` workflow reaching dry `done` (6 DB rows); task-lifecycle is the cleanest both-version-forms FSM vehicle. |
| R7 | MET | All 11 unversioned (absent optional `version`). Version-in-digest mechanism **live-verified this run** via `computeDefinitionDigest` (`composition-baseline.ts:110-116`): task-lifecycle base `sha256:fb5b8639…` → version `1.2.3` `sha256:fcd81ddc…` → differ=true; wrapup-pipeline base `sha256:3d8e8964…` → `sha256:60fc2ca3…` → differ=true. Both base digests match §1 and the live DB exactly. (Minor note: §7's cited digest pair `3d05d63d…/fc4bd91f…` matches no live repo-workflow probe — see Finding 1 in SECUA; the mechanism claim is independently confirmed.) |
| R8 | MET | Compact matrix + disposition summary + pilot recommendation published in the artifact (`docs/inventory/d8-0731-workflow-fit-classification.md` §8 at line 162, 184 lines total, §1–§8 + Unknowns); all Solution anchors resolve to exact sections this run (`:9` §1, `:33` §2, `:57` §3, `:81` §4, `:112` §5, `:132` §6, `:143` Recommendation, `:153` §7, `:162` §8). No production workflow or public CLI surface changed (git status verified). |
| R9 | MET | Durable artifact `docs/inventory/d8-0731-workflow-fit-classification.md` exists (§1–§8 + Unknowns, 184 lines) and is linked from the Solution with line anchors; §8 records dispositions + recommendation + evidence commands; the artifact is the reviewable deliverable. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| All 11 repository workflows and any shadowing bundled/installed/project-local definitions are accounted for independently of the composition baseline. | MET | command | 11 `config/workflows/*.yaml` listed; `apps/cli/config/workflows/` + `.spur/workflows/` absent (`ls`); installed copies byte-identical (`diff -q SAME` ×3 spot-check this run, review ×11); all 11 `definitionDigest` re-read from `runs.metadata_json` match §1; baseline holds 8 — accounted for independently of it. |
| Every workflow has an evidence-grounded caller/deployment role, fit verdict, target disposition, version state, and confidence; absent optional `version` is valid and reported as unversioned. | MET | command | §2 matrix + DB `task_run_links` (10 rows) + code/plugin caller anchors (task.ts:439,1528; feature.ts:556; dev-wrap/dev-idea/dev-run); §1 + §7: all 11 `unversioned`; §4 dispositions with confidence. |
| [doc-only] Run and continue paths, configured and bundled resolution, inline execution, lifecycle, projection, and dry-run limits are represented where they affect a workflow. | MET | static-ref | §1 resolution/layer (project → installed, byte-identical), §3 dry-run semantics (real-guard smoke, wrapup-only dry `done`), §7 continue-ignores-drift + digest implications, §2 inline drivers (dev-idea/dev-run) + lifecycle rows. |
| [doc-only] Deletion, retirement, or demotion opportunities are evaluated before optimization or new infrastructure. | MET | static-ref | §4 "Retire candidates evaluated before optimization" — demote-to-procedure/fixture for pr-review/docs-pipeline/wayfinder; retire explicitly deferred (no production change); duplicated orchestration/unconditional/overlarge-bounds/ownership/parity items each evaluated. |
| Each pilot has a closed prerequisite table and a proven real caller; no known-broken primitive is treated as safety or observability evidence. | MET | command | §5 closed prereq table per candidate (READY/INELIGIBLE/NOT READY/not-selected); wrapup + task-lifecycle proven real callers (DB + plugin docs); §6 explicitly "no known-broken primitive treated as evidence" — feature-transition corpus-gate + lifecycle guards on working `spur` verb surface. |
| `feature-dev` is ineligible while nested review is impossible, no-caller definitions are not pilots, and `task-pipeline` is excluded. | MET | command | §5 feature-dev INELIGIBLE (F-2 nested review, `feature-dev.yaml:156-169`); §6 no-caller defs not pilots + task-pipeline excluded (R6); lifecycle provenance gate (`lifecycle-adapter.ts:100-130`) re-read. |
| No production workflow or public CLI surface changes occur in this ticket. | MET | command | `git status --porcelain`: no `config/workflows/`, `apps/cli/schemas/`, or `packages/app/src/workflow/` modifications; only the new artifact (untracked) + task file + D8 feature doc changes (0730's `real-run-cost.ts`/`pipeline-budgets.ts`/test belong to 0730's diff, not 0731). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Scope:** task 0731 (feature D8) — durable artifact `docs/inventory/d8-0731-workflow-fit-classification.md` (184 lines, §1–§8 + unknowns), Solution/Testing sections, cross-consistency with `docs/inventory/d8-0729-workflow-contract-inventory.md` (§F register) and `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` (cohort freeze). Independent verification pass: DB reads (`.spur/spur.db` — `runs`, `task_run_links`, `queue_jobs`), YAML graph re-derivation (all 11 `config/workflows/*.yaml`), `workflow validate` ×11, `workflow show`, live version-in-digest probe, caller-anchor verification (code + plugin docs), composition-baseline + schema reads, git status (no production change).

**Verdict: APPROVE** — R1–R9 all substantively met and independently verified; two minor findings (P3/P4) recorded; none affect any disposition, pilot selection, or safety conclusion.

**Findings (ranked)**

| # | Priority | Dimension | Location | Finding |
| --- | --- | --- | --- | --- |
| 1 | P3 | Correctness (graph fact) | `d8-0731-workflow-fit-classification.md:57` (§3) and `:81` (§4) vs `config/workflows/idea-pipeline.yaml:123,219,277,334` | idea-pipeline pause count is **4**, not 5. Only `idea-eval`/`feature-check`/`design-approval`/`batch-create` carry `pause: true` (YAML lines 123/219/277/334). §3 "5 pauses" and §4 "5 HITL pauses" overcount by one — the 5th `grep -c "pause: true"` match is a **comment** on YAML line 500. No disposition/pilot decision changes (idea-pipeline is rank 4, not selected); correct in the 0733 synthesis pass. |
| 2 | P4 | Accuracy (transcription) | `d8-0731-workflow-fit-classification.md:33` (§2) | §2 task_run_links 0539 listing names **6 IDs** for a 5-row group and double-lists `a84c72a3` — that run links to **0729** (`kind=pipeline`), not 0539 (DB: `task_run_links` row `trl_9575bbb5…`). Actual 0539 group = 5 (`5460643c`,`e62a290e`,`7d855950`,`86e84e88`,`b35417b5`). Total count (10 rows) and the "binding hazard, not real-caller proof" conclusion are correct. |

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | All 11 `config/workflows/*.yaml` resolve to byte-identical installed copies (`diff -q SAME` ×11, verified this review); `apps/cli/config/workflows/` and `.spur/workflows/` absent (no shadowing surface). Live `definitionDigest` per run matches §1 for all 11 (DB `runs.metadata_json`, verified). Baseline holds 8 (missing feature-lifecycle/history-anatomy/task-lifecycle — `config/workflow-composition-baseline.json` keys, verified) with stale digests (task-pipeline baseline `sha256:455fcf48…` vs live `b3b82966…`). Schema `required: ['name','initialState','states','transitions']`, `version: {type:string}` no minLength, `kind: const state-machine` (verified `apps/cli/schemas/state-machine-workflow.schema.json`). `workflow validate` ×11 all `valid` exit 0. |
| R2 | MET | All code/plugin anchors verified: `task.ts:439,1528` (`makeLifecycleAdapter(TASK_LIFECYCLE_PROFILE)`), `feature.ts:556` (`FEATURE_LIFECYCLE_PROFILE`), `lifecycle-adapter.ts:47,55`, `make-lifecycle-adapter.ts:49`; `workflow.ts:71-72,402-414,446,656` (nested-run guard + `SPUR_WORKFLOW_RUN_ACTIVE=1`); `dev-wrap.md:31,45`, `dev-wrapall.md:33,47`, `dev-idea.md:45-46`, `dev-plan.md:46-47`, `dev-run.md:66-67`, `dev-runall.md:52,69`, `spur-dev/SKILL.md:87-88`, `dev-find-issue.md:31`, README:336,603-611, `cross-cutting.md:539`. 5 no-proven-caller workflows confirmed (docs-pipeline, history-anatomy, pr-review, basic, wayfinder-resolution). `task_run_links` = **10** rows (verified; vs 0730's 9 — delta = `run_cdae9c31` wbs 0730). `queue_jobs` = scheduler-only (`history.refresh`/`smoke`/`system-events-prune`). |
| R3 | MET | Graph facts re-derived from all 11 YAMLs: states/terminals/pauses/action-counts match §3 for every workflow (verified by parse + grep) **except** idea-pipeline pause count (Finding 1). wrapup-pipeline is the only workflow reaching dry `done` (6 runs, DB-verified); all other 10 workflows' dry runs are `failed` (59 total failed dry + 6 wrapup done + 3 non-terminal = 68). Honest `?` unknowns correctly marked (feature-lifecycle dry-run, history-anatomy/pr-review caller state). |
| R4 | MET | Fit gate (replay + machine branch + durable record) applied consistently; dispositions internally coherent. feature-dev nested-review F-2 verified (`config/workflows/feature-dev.yaml:156-169` command.gate → `spur workflow run .spur/workflows/pr-review.yaml`, `softFail:true`, `timeoutMs:1800000`; guard refusal at `workflow.ts:402-414`). Duplication/unconditional/overlarge-bounds/ownership/parity-cost items all evaluated. Retire deferred to 0732/0733 — consistent with AC (no production change). |
| R5 | MET | Prerequisite table closed per candidate against 0729 §F. wrapup-pipeline READY non-pause path verified (no command.gate — F1 n/a; feature-transition is a CLI-verb shell, F2 n/a; no proof.fingerprint — F5 n/a; `profile=auto merge=false` avoids branch-cleanup pause, F4 n/a). task-lifecycle READY: provenance gate at `lifecycle-adapter.ts:100-130` requires `kind=pipeline` run link or `SPUR_PROVENANCE_OVERRIDE=1` (verified). feature-dev INELIGIBLE (F-2); pr-review NOT READY (superskill staging unknown, 0729 §G-4). |
| R6 | MET | Exclusion logic sound and follows R6 as written: task-pipeline excluded (canonical); 5 no-caller defs not pilots; feature-dev ineligible (F-2). Eligible real-caller surrounding = task-lifecycle, feature-lifecycle, wrapup-pipeline, idea-pipeline. Ranking (#1 wrapup-pipeline, #2 task-lifecycle) verified against evidence: wrapup is the only eligible real-caller `workflow run` workflow reaching dry `done` (DB-verified), reversible (append-only artifacts, task status never mutated), low blast radius; task-lifecycle is the cleanest both-version-forms FSM vehicle. |
| R7 | MET | All 11 unversioned (absent optional `version`); `explicit(<literal>)` only for non-empty quoted literal. Live probe (this review): version-only edit changes digest (`computeDefinitionDigest`, `composition-baseline.ts:110-116`): task-lifecycle base `sha256:fb5b8639…` → version `1.2.3` → `sha256:fcd81ddc…`, differ=true. Continue-ignores-drift (0729 §E/§F-4) correctly carried. No invented registry/semantics. |
| R8/R9 | MET | Compact matrix + dispositions + pilot recommendation published in artifact; Solution summarizes and links with line anchors — all 9 anchors (`:9/:33/:57/:81/:112/:132/:143/:153/:162`) resolve to the exact correct artifact sections (verified). No production workflow definition or public CLI surface changed (git status: no `config/workflows/`, `apps/cli/schemas/`, `packages/app/src/workflow/` modifications). |

**SECUA (classification task — no code changed)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | C | artifact §3/§4, `idea-pipeline.yaml:123,219,277,334` | idea-pipeline pause overcount (Finding 1) — graph fact, no safety/decision impact. |
| P4 | S | `d8-0731-workflow-fit-classification.md:33` | task_run_links 0539 listing transcription (Finding 2) — evidence rows are still the 10 DB-verified links; conclusion unchanged. |

**Residual risk**

1. Task-lifecycle dry-probe cleanup (probe run + 51 transition rows deleted post-probe) is not independently re-verifiable; the current cohort (68 = 65 dry + 3 non-terminal) matches the claimed restored state exactly, so confidence is high but not absolute.
2. feature-lifecycle dry-run behavior marked `?` (not probed) — honest gap, no impact on conclusions.
3. `superskill script path sp pr-reviewing.ts` / `history-anatomy-cache.mjs` staging behavior (0729 §G-4) still unverified on a real machine — carried forward as an honest unknown, not a defect of this task.
4. wrapup-pipeline pause/resume path stays unsafe under F4 (continue-drift) until the digest-comparison fix lands — correctly scoped out of the pilot's initial path.

**Disposition: approve** — research/classification deliverable meets all nine requirements with independently verifiable evidence; the two minor findings (P3 pause overcount, P4 listing transcription) do not change any disposition, pilot rank, or safety conclusion. Correct both in the 0733 synthesis pass when this artifact is consumed.

### References

- `config/workflows/`; `apps/cli/config/workflows/`; `.spur/workflows/` when present.
- `config/workflow-composition-baseline.json`; `packages/app/src/workflow/composition-baseline.ts`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/lifecycle-adapter.ts`; `packages/app/src/workflow/progress-projection.ts`.
- `apps/cli/src/commands/workflow.ts`; `apps/cli/src/workflow/make-lifecycle-adapter.ts`.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `plugins/sp/tests/inline-pipeline-driver.test.ts`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`.

### History

- 2026-09-02T17:35:38.256Z todo → wip (system)
- 2026-09-02T17:49:54.562Z wip → testing (system)
- 2026-09-02T17:49:59.671Z testing → done (system)
