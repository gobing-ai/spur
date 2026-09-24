---
schema_version: 1
name: Deliver the measured task-pipeline optimization selected by 0912
status: done
template: standard
created_at: 2026-09-22T02:56:46.301Z
updated_at: "2026-09-23T23:27:34.824Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w04
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914", "0915", "0912", "0913"]
---

## 0917. Deliver the measured task-pipeline optimization selected by 0912

### Background

0912 is complete. Its selected pilot is adoption of the existing inline action-emission and terminal-close contract, with a frozen 2026-10-06 decision date and a target of at least three real terminal inline runs. It did not select a faster graph: the cohort had no terminal inline DB rows, only one structured engine trace, and no session/cost joins. Task 0913 is also done and supplies the provenance and measured-versus-estimated evidence rules. First check whether the selected observability pilot has already been delivered under D62/P; do not implement it twice.

This task owns the D63 decision at the task-pipeline seam: establish a comparable post-adoption cohort, validate the selected observability outcome, and either propose one bounded speed candidate from that evidence or record why none is eligible. An observability improvement is not a measured speed improvement. No task-pipeline graph edit is required when the evidence is insufficient. Preserve ADR-107 activation eligibility, independent verification, role isolation, proof freshness and existing candidate expiry. Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md.

### Requirements

- [x] R1. Check the 0912 inline tracing and terminal-close pilot against its frozen target and 2026-10-06 deadline using attributable real runs; reuse any completed D62/P implementation and report insufficient samples honestly.
- [x] R2. Build a comparable task-pipeline cohort after instrumentation, separating definition digest, inline/engine/fleet mode, code/docs work, terminal/attempt identity, and known versus missing cost or duration evidence under 0913's contract.
- [x] R3. Select at most one speed candidate only if the cohort identifies a repeatable bottleneck; predeclare its primary benefit metric, threshold, reliability floor, exclusions, sample requirement, owner and deadline before evaluation. Otherwise record INSUFFICIENT_EVIDENCE and the smallest bounded experiment.
- [x] R4. Preserve admission, proof, independent review and verification, role/capability policies and full fallback on unknown dependency scope. Promote only on comparable real evidence through the existing process; retire an unproven candidate by its deadline without claiming speed gains.

### Acceptance Criteria

- [x] AC1 — The 0912 observability pilot is evaluated against its original real-run target and deadline; missing runs or joins remain unknown, and D62/P work is not duplicated. (req: R1)
- [x] AC2 — Every speed comparison names the comparable run cohort, definition/mode/change-class strata and known/total measurement coverage. (req: R2)
- [x] AC3 — One eligible candidate has predeclared metrics and an expiry, or an explicit insufficiency verdict names the evidence gap and smallest experiment before any graph edit. (req: R3)
- [x] AC4 — Existing safety and proof contracts pass on every reachable route; promotion requires the declared real benefit and reliability floor, while an unproven candidate retires. (req: R4)
- AC5 — NOT MET by declared design: INSUFFICIENT_EVIDENCE leaves speed adoption unclaimed (honest task outcome per spec; see Solution R3).

Feature-level traceability: this task delivers D63 scenario R4; AC1–AC4 give its task-local regression evidence. An insufficient-evidence outcome satisfies honest task completion but leaves speed adoption unclaimed.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The first gate is evidence, not a graph edit. Compare the 0912 frozen baseline with new real terminal inline runs and verify both action rows and run closure; no projection or replay substitutes for the pilot's three-run live claim. Use the 0913 provenance and coverage fields, and inspect whether 0914's installed bridge or later D62/P work already wires the driver. The current pilot improves observability; it creates the denominator needed to judge speed, but it cannot by itself establish lower latency or cost.

If the new cohort exposes a repeated avoidable model or repair cost, define one candidate using the existing route table and promotion registry. Preserve all current completion gates and compare like execution modes, change classes and definition digests. If no candidate clears the evidence floor, finish with a documented no-change decision and a named next measurement; this is a valid task outcome but does not claim the feature's speed aspiration was delivered. Do not add a standing v2 YAML or a new measurement service.

### Plan

- [x] 1. Recheck 0912/0913 and later D62/P receipts; confirm the selected tracing/closure pilot's implementation and frozen live target by its deadline.
- [x] 2. Collect the smallest comparable post-adoption cohort, with run IDs, definitions, modes, change classes, terminal evidence and explicit measurement coverage.
- [x] 3. Decide whether one speed candidate is eligible. For an eligible candidate, freeze criteria before changing the graph and run safety/replay checks plus real comparison. For insufficient evidence, record the bounded next experiment and keep the current graph.
- [x] 4. Resolve any candidate through the existing promotion or retirement path; update only affected task-pipeline callers, guidance and the outcome record.

### Solution

<!-- spur:0935-r2-reevaluation -->
**2026-09-23 re-evaluation (task 0935 R1–R2; replaces "before the deadline" with measured evidence).** The named bounded experiment is now executed: three real terminal inline history-anatomy runs driven through the installed 0914 bridge (setup → per-stage `--action` emission → terminal `--close`), each with attributable DB rows — run ids `d6e3ec3f-3e0f-4155-bd6b-c23134a971fe` (miss: render→enrich→gate FAIL→correct→gate PASS→validate FAIL→correct→validate PASS→stamp→publish), `a3e79428-a30e-4e68-9d9d-d138461aecac` (miss: full path, gate/validate PASS first pass), `75fed91a-be3c-4d32-be64-fd6b48502d95` (same-day cache hit: refresh-provenance→publish, zero model hops); all `status=done`, 19 `action_runs` rows total. Measured citation in the ADR-076 vocabulary (`measureAgentRunHistory` over the three run ids, run this task: `scripts/commands/workflow-promotion.ts:289`; bridge entry `plugins/sp/scripts/inline-run-setup.ts:78`): **3 real run(s), median 2 agent.run action(s)/run, median 238,500 ms/run** (runs with model hops; min 0 / max 5 actions — the cache-hit run recorded zero `agent.run` rows and its deterministic glue measured ~3.5 s total). Decision: **INSUFFICIENT_EVIDENCE stands for any speed candidate** — the cohort exposes no repeatable model-cost bottleneck a graph edit could remove: the same-day cache hit already records zero model hops for repeat invocations, and the remaining enrichment/validation hops are what a legitimate forensic report costs. No speed candidate is proposed; the 0912/0921 scope-normalization promotion stands as applied (enrich/validate/correct are Layer-1 role-annotated single-model hops). No graph edit; cohort evidence recorded by 0935 (task file + `docs/report/2026-09-23-history-anatomy.md`, published through the workflow's own validate gate).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Pilot re-checked against frozen target (≥3 attributable terminal inline runs by 2026-10-06) with a fresh census this run: `.spur/spur.db` runs = 1488 total (state-machine 1485 / inline 2 / null 1); both inline rows (df3fb741→0608, 3a3f1f1d→0607, created 2026-08-20) are pre-adoption with completed_at NULL and 0 action_runs; zero post-2026-09-01 inline rows (345→346 post-Sep-1 rows all state-machine). Schema anchor re-read: `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema-sql.js:6` = `mode TEXT`. D62/P not duplicated: 0914 done, Solution section intact (line anchor drifted — see checks). Honest unmet-today target; missing samples reported unknown. Executed: bun sqlite census queries (this run). |
| R2 | MET | Comparable cohort and strata named in Solution R2 (definition digest, inline/engine/fleet mode, code/docs class, terminal identity, known/total coverage) matching 0913's provenance contract; coverage honestly 0/0 → 0/3 — re-confirmed empty by this run's census. |
| R3 | MET | INSUFFICIENT_EVIDENCE recorded with the named gap (zero attributable terminal inline runs) and smallest bounded experiment (≥3 real runs through the 0914 bridge before 2026-10-06, then re-audit). No graph edit: closing commit 978d4a263 is docs-only (1 file, +45/-18 — re-read `git show --stat`). Follow-up debt carried by task 0935 R1/R2 (backlog), not silently dropped. |
| R4 | MET | No YAML/config/runtime change in 0917's commits (docs-only); no promotion claimed; no candidate created. Note: the history-anatomy-scope-inline candidate cited at audit time was later RESOLVED by 0921 (commit f022203f6) — `config/workflow-candidates.json` now has `"candidates": []` (re-read); 0917's preservation claim held at audit time and the machinery ran its course. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R4 — Safe optimization audit preserves contracts and reports honestly | MET | command | Fresh DB census + docs-only closing commit verify the audit's honest INSUFFICIENT_EVIDENCE close with all safety/proof contracts untouched (this run). |
| AC1 | MET | command | Pilot evaluated against original target/deadline; missing runs reported unknown; D62/P not duplicated — census queries re-run this run (output above). |
| AC2 | MET | static | Cohort, strata and 0/0→0/3 coverage named in Solution R2 — re-read this run. |
| AC3 | MET | static | No eligible candidate; insufficiency verdict names the evidence gap and smallest bounded experiment before any graph edit — Solution R3 re-read; docs-only commit verified. |
| AC4 | MET | command | Safety/proof contracts untouched (no reachable-route change: docs-only commit); no promotion; nothing created to retire — `git show --stat 978d4a263` (this run). |
| AC5 | N/A | static | NOT MET by declared design: INSUFFICIENT_EVIDENCE leaves speed adoption unclaimed — the task's own AC note declares this an honest task outcome; speed adoption remains unclaimed and tracked by 0935. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | design-conformance | — | Audit-only deliverable (mutationPolicy: no source edits); INSUFFICIENT_EVIDENCE close with bounded experiment named — matches Design. DONE. |
| P4 | secua-review | — | Docs-only change; no runtime surface. No findings. |
| P4 | stale-anchor-drift | — | P3 note: two cited anchors drifted after the audit — `0914:68` (Solution content shifted by later re-records; semantic claim intact) and `config/workflow-candidates.json:6` (candidate since resolved by 0921, candidates now empty). Temporal drift only; both claims re-verified true at their audit time and in substance today. |
| P4 | coverage | — | Coverage: N/A (audit task; no runtime code path added). |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:59.825Z todo → blocked (system)
- 2026-09-23T19:13:57.447Z blocked → wip (system)
- 2026-09-23T19:24:56.530Z wip → testing (system)
- 2026-09-23T19:25:16.221Z testing → done (system)

