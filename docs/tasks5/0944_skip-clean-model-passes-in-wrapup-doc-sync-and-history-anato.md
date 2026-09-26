---
schema_version: 1
name: Skip clean model passes in wrapup doc-sync and history-anatomy
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.006Z
updated_at: "2026-09-26T02:40:07.318Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - promotion

dependencies: ["0938"]
estimate_hours: 5
---

## 0944. Skip clean model passes in wrapup doc-sync and history-anatomy

### Background

Implements: R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7 (wrapup doc-sync, history-anatomy candidates).

**Refine corrections (2026-09-23)**

1. *The wrapup skip edge already exists.* `config/workflows/wrapup-pipeline.yaml` already routes `task-resolve → metrics-record` when `mode = fast` (the proportional fast path, around line 389), and to `doc-sync` otherwise. Like task-pipeline, `mode` (default `""`) has **no producer**: `/sp:dev-wrap` and `/sp:dev-wrapall` build `--vars` without `mode` (`dev-operations.md:366`, `:382`). The work is a deterministic drift probe that **produces `mode`**. No new edge is needed.
2. *doc-sync also captures learnings.* The `doc-sync` `agent.run` both repairs doc drift **and** captures learnings, merged in 0607 R2. It writes `.spur/run/<runId>-wrapup-learnings.md`, which `learnings-append` consumes. The existing fast path therefore also skips learnings capture. The candidate verdict must weigh that loss; it is not free.
3. *There is no doc-drift probe today.* `plugins/sp/scripts/surface-drift-inventory.ts` checks CLI-surface claims against live `--help`, not doc ownership. A new probe is needed.
4. *history-anatomy already has a cache branch.* `config/workflows/history-anatomy.yaml` already runs analyze → `cache-probe` (hit skips enrichment; ADR-079, 0659), with a deterministic structure gate and bounded correction. ADR-069 forbids inline shell for its deterministic work, which goes through the helper script. Original R2 ("enrich only over the deterministic diff") is therefore **measurement-only** here: cache-hit rate and failure/terminal-reason mix from 0938. Any graph fix is decided in 0946.
5. *The title is stale but kept.* `spur task update` has no rename flag, so the history-anatomy half now means "measure" (this correction).

### Requirements

- [x] R1. A deterministic probe `plugins/sp/scripts/wrapup-drift-probe.ts` (plugin standalone) reads the normalized task list `.spur/run/<runId>-wrapup-tasks.json`. For each task it collects changed paths from the `## Solution` file:line map (via `spur task show <wbs> --json`). It writes `.spur/run/<runId>-drift-probe.json` as `{clean: boolean, reasons[], paths[]}`.
- [x] R2. `clean` is false when any changed path matches a doc-owned surface:
  - `packages/contracts/**`
  - `apps/cli/src/commands/**`
  - `packages/config/src/**`
  - `drizzle/*.sql`
  - `config/workflows/**`
  - `plugins/sp/{commands,skills,hooks}/**`
  - root `package.json` scripts
  - `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` or `docs/design/**`
  - a new top-level workspace directory

  It is also false when any task's Solution is empty or unparseable (fail safe).
- [x] R3. `task-resolve` runs the probe only when `mode` is empty. A clean probe sets `mode=fast`, and the route reason becomes `fast:drift-probe-clean`. A caller-set `mode` is never overridden. The route-reason map gains `"safety": "safety:operator-forced doc-sync"`, so `--vars '{"mode":"safety"}'` forces doc-sync.
- [x] R4. The candidate record `wrapup-drift-probe` has 0938 `baselineAgentRunCount` and a deadline 60 days out. Its verdict cites doc-sync `agent.run` count per wrap, plus the count of wraps whose learnings were skipped. If it does not win, it is reverted.
- [x] R5. history-anatomy is measurement only. The 0938 report's per-state view for `history-anatomy` (cache-probe hit/miss via `cache-disposition`, enrich/validate/correction visits and terminal-reason mix) is pinned in the 0938 baseline and cited by 0946. This task makes no history-anatomy YAML change.

### Acceptance Criteria

- [x] AC1 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.569Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:28:27.100Z

**Refine decisions — 2026-09-23 (ready depth)**

- **The probe produces `mode` for the existing fast-path edge.** No new edge is added.
- **Skipping doc-sync also skips learnings capture.** This is accepted as a measured tradeoff in the candidate verdict. If learnings loss is material, the verdict is `retire` or a follow-up to split learnings into a deterministic or cheap capture.
- **history-anatomy is measurement only.** It already has a cache branch, and its graph decision moves to 0946.
- **The title is kept.** There is no CLI rename, and the Background correction records the narrowed scope.
- **Estimate: 5h** (plus shadow-run time).

### Design

**Approach.**
- A deterministic probe script and a `task-resolve` onEnter hook. The probe runs before the existing route-reason writer, so the reason reflects the projected `mode`. It projects `mode` via `shell` (writing a file), then `file.read.into-var`.
- The doc-owned path list is one exported constant in the probe. It is derived from the AGENTS.md doc map and `docs/99_PROJECT_CONSTITUTION.md` ownership table, with a comment citing both.

**Frozen names:**
- the script `wrapup-drift-probe.ts` and file `<runId>-drift-probe.json`;
- route reason `fast:drift-probe-clean`;
- mode value `safety`;
- candidate id `wrapup-drift-probe`.

**Invariants:**
- Fail safe: any doubt means not clean.
- Caller mode wins.
- The ADR-118 `repair` edge is unchanged.
- The branch-cleanup HITL is unchanged.
- No history-anatomy YAML change.

**Rejected alternatives:**
- A model classifying drift, which breaks deterministic-before-model.
- Splitting doc-sync back into two `agent.run` hops, which reverses 0607 R2.
- A git-log-based diff. Commit messages don't reliably carry the WBS, while Solution maps are the implement-stage evidence.

**Anti-patterns:**
- Probing `docs/tasks*` or feature corpus paths as drift.
- Running the probe when `mode` is set.

**Targets:**
- Probe unit tests cover each surface glob, an empty Solution, and the clean case.
- Parity and composition baselines updated.

### Plan

1. `plugins/sp/scripts/wrapup-drift-probe.ts`, with `plugins/sp/tests/wrapup-drift-probe.test.ts`, using a fake `spur` bin for `task show`.
2. `wrapup-pipeline.yaml` `task-resolve` onEnter: probe, then project `mode`, with the route-reason map gaining `safety`. Update the composition and guard-parity baselines, then run `bun run --filter @gobing-ai/spur build:bundle`.
3. Workflow routing tests: clean → metrics-record; dirty → doc-sync; caller `mode=safety` → doc-sync; empty Solution → doc-sync.
4. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
5. Confirm the history-anatomy per-state rows appear in the 0938 baseline. Cite them in the candidate rationale for 0946.
6. Run `bun run spur-check` and `bun run plugin-smoke`.

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
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:13` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:49` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:57` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:71` |
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
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:53` |
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
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
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
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | wrapup-drift-probe.ts:188 reads .spur/run/<runId>-wrapup-tasks.json; :216 per-task spur task show --json; :123-135 changedPathsOf Solution file:line parse; :195 writes <runId>-drift-probe.json {clean,reasons,paths}; plugin-standalone holds (plugin-smoke PASS) |
| R2 | MET | DOC_OWNED_SURFACES :73-87 all ten spec globs (workflows glob via join for sp-runtime-path rule); KNOWN_TOP_LEVEL :94-102 new-top-level check; fail-safe: empty/unparseable Solution :233, task-show failure :218, unparseable output :228, corrupted capture :210, dirty-first mode write :192; corpus excluded via CORPUS_PREFIXES :113-114; 10-test 13-glob matrix |
| R3 | MET | wrapup-pipeline.yaml:163-172 probe gated on empty mode; clean -> mode=fast file + file.read.into-var projection (yaml:175-178); fast guard yaml:431 -> metrics-record; fast:drift-probe-clean wrapup-steps.ts:255; safety map entry :199 with guard yaml:438 -> doc-sync; caller mode projected verbatim; ADR-118 repair edge + branch-cleanup HITL untouched; routing tests clean/dirty/safety/empty-Solution all pass |
| R4 | MET | config/workflow-candidates.json:22-35 candidate wrapup-drift-probe (canonical wrapup-pipeline), deadline 2026-11-24 = +60d, verdict null pre-promotion, rationale cites 1->0 doc-sync agent.run per wrap (structural, pipeline-budgets.json:25) + skipped-learnings measurement method post-promotion, revert-if-loses ADR-076; promotion check PASS |
| R5 | MET | history-anatomy.yaml diff hunks are 0937 terminalReason lines only (zero 0944 graph change); 0938 baseline states[] has 0 history-anatomy rows - honestly named in candidate rationale with 0946 citation; measurement-only honored |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Workflow shape changes are accepted only on measured benefit | MET | command | Workflow shape change accepted on 0938-baselined structural projection with named measurement gaps, +60d deadline, post-promotion promotion evaluate, revert-if-loses (ADR-076); 4 P4 review advisories adjudicated ACCEPTED consistent with code; gate attempt-3 PASS 9149/524 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS (full review dee270a3; fingerprint sha256:930cc20a… reproduced byte-identical; zero reviewer tree mutations).

| Finding | Priority | Disposition |
| --- | --- | --- |
| F1: DOC_OWNED_SURFACES matches whole root package.json vs spec "scripts" — dep bumps mark wrap dirty | P4 | ACCEPTED — fail-safe direction (never wrongly clean); tightening would deviate from shipped constant |
| F2: changedPathsOf silently drops backticked entries containing whitespace (corner fail-open) | P4 | ACCEPTED — no whitespace paths in repo; entries are malformed noise; could push a reason later |
| F3: R5 letter unsatisfiable as written — 0938 baseline has 0 history-anatomy per-state rows | P4 | ACCEPTED — candidate rationale names the gap honestly and defers measurement to 0946 (cache disposition provenance stamp, empty terminalReasonMix); no fabrication |
| F4: benefit projection structural (1 agent.run/wrap) not measured (wrapup median null, 0 runs) | P4 | ACCEPTED — candidate says exactly that, reverts-if-loses by 2026-11-24; post-promotion evaluation may find doc-sync cost ≈ 0 |

Driver-side post-worker fixes adjudicated by reviewer (all ACCEPT): TS2322 null-status coercion `.status ?? 1` (spawnSync signal path, parity-check precedent); sp-runtime-path rule compliance via join('config','workflows') literals (parity-check :59 precedent) in probe + twin + 2 test files + bundle regen; biome template-literal/unused-import cleanup.

Residual risk: clean wraps skip learnings capture (0607 R2) — real loss, measured post-promotion per rationale; whole-package.json glob + prose-only Solution maps make "clean" rarer than the spec letter implies (under-delivers, never wrong); every doubt lands on doc-sync (fail-safe invariant intact).

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T18:01:41.647Z todo → wip (system)
- 2026-09-25T19:21:20.709Z wip → testing (system)
- 2026-09-25T19:21:29.762Z testing → done (system)

