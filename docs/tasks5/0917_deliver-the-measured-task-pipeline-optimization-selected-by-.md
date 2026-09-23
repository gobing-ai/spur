---
schema_version: 1
name: Deliver the measured task-pipeline optimization selected by 0912
status: done
template: standard
created_at: 2026-09-22T02:56:46.301Z
updated_at: "2026-09-23T19:25:16.221Z"
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

Audit outcome: INSUFFICIENT_EVIDENCE — no graph edit; current task-pipeline graph unchanged (Design, Plan 3).

R1 — pilot status vs frozen target. The 0912-selected pilot (inline action-emission + terminal-close adoption) is DELIVERED: task 0914 (done) shipped the portable inline bridge reusing the existing setup/fingerprint/trace owners, so D62/P is not duplicated and nothing is re-implemented. The frozen live target — ≥3 attributable real terminal inline runs by 2026-10-06 — is NOT met. Delivered-implementation citation: `docs/tasks5/0914_make-installed-inline-workflow-execution-use-the-authoritati.md:68` (Solution — installed inline execution). Schema citation: `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema-sql.js:6` (`mode TEXT` on `runs`). Evidence: the main corpus DB (`/Users/robin/xprojects/spur-new/.spur/spur.db`, `runs` table) holds 1487 runs — 1484 `state-machine`, 2 pre-adoption `inline` rows (wbs 0607/0608, 2026-08-20, no action rows, never closed) and 1 empty-mode legacy row; all 345 post-Sep-1 runs are `state-machine` and zero post-adoption `inline` terminal rows exist. Pre-adoption D62-era `*-event-trace.md` projections under `.spur/run/` are excluded by contract — no projection substitutes for the live three-run claim (Design). The worktree DB copy likewise carries only 3 legacy task-lifecycle rows. D63's inline-driven tasks (0915, 0916, 0918, 0919, 0920) produced corpus transitions and verdict artifacts but no engine run rows — they are not attributable pilot runs. Missing samples are reported unknown, not projected (Design).

R2 — comparable cohort (0913 contract fields). Cohort = post-adoption task-pipeline runs, strata: definition digest (task-pipeline YAML), mode (inline vs engine vs fleet), change class (code/docs), terminal identity (run row + action rows + closure), measurement coverage (cost/duration known vs missing). Coverage today: 0/0 post-adoption runs → 0/3 against the frozen ≥3 target; cost and duration evidence missing by definition (no rows). The cohort is honestly empty.

R3 — candidate decision. No speed candidate is eligible: with zero comparable runs there is no repeatable bottleneck to select against, so no metric/threshold/reliability-floor/exclusion/sample predeclaration is frozen and no graph edit is made. Recorded per AC3: evidence gap = zero attributable terminal inline runs; smallest bounded next experiment = drive ≥3 real task-pipeline runs through the installed 0914 bridge (`--agent inline`) on genuinely remaining work (0921's unblocked tasks or a small chore feature) before 2026-10-06, then re-run this audit; if the target is still unmet at the deadline, retire the pilot claim without asserting speed gains.

R4 — contracts preserved. No YAML/graph change → ADR-107 eligibility, proof freshness, independent verification and role policies untouched; no promotion claimed; nothing to retire (no new candidate was created). The existing candidate expiry machinery (0920's `history-anatomy-scope-inline`, `config/workflow-candidates.json:6`, 2026-10-07) is unaffected.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Pilot = "inline-driver terminal close + structured action emission" (0912 Solution, deadline 2026-10-06; live claim requires ≥3 terminal inline runs per 0912 R6/AC6 row). 0912 doc read directly: `docs/tasks5/0912_establish-the-post-delivery-workflow-baseline-and-select-a-m.md` (Solution "Key measured results": pilot SELECT, deadline 2026-10-06, F2 0/15 inline runs with action rows). D62/P not duplicated: `docs/tasks5/0914_make-installed-inline-workflow-execution-use-the-authoritati.md` status `done`, line 68 = Solution lead "Portable inline execution reuses the existing application setup, fingerprint and trace owners through a generated bundle" (citation exact). Frozen target vs evidence, independently re-measured: corpus DB `/Users/robin/xprojects/spur-new/.spur/spur.db` runs = 1487 total; mode census state-machine 1484 / inline 2 / empty 1. The only 2 `inline` rows (df3fb741, 3a3f1f1d) are PRE-adoption: `task_run_links` binds them to wbs 0608/0607 with created_at 2026-08-20T18:13:45Z / 18:59:23Z, `completed_at` NULL (never closed), 0 `action_runs` rows, 0 `phase_runs`, epoch-bug created_at ≈1,787,251,934 ms (1970 display) → not attributable pilot runs. Post-2026-09-01 census: 345 runs, ALL `mode=state-machine` (incl. 31 task-pipeline rows: 17 failed / 10 running / 3 done / 1 paused — none inline). Worktree DB `.spur/spur.db` = 3 legacy `state-machine` task-lifecycle rows only, as claimed. Missing samples reported unknown, not projected; deadline still open → recorded as honest unmet-today, not "failed". Schema citation exact: `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema-sql.js:6` = `mode TEXT`. |
| R2 | MET | Cohort and strata named in Solution R2: post-adoption task-pipeline runs stratified by definition digest (task-pipeline YAML), mode (inline vs engine vs fleet), change class (code/docs), terminal identity (run row + action rows + closure), measurement coverage (cost/duration known vs missing) — matching the 0913 provenance contract (`docs/tasks5/0913_make-session-review-and-dogfood-produce-trustworthy-workflow.md` R4/AC4: "run identity, source and executing-definition provenance, execution mode, measurement source/scope and known/total coverage"). Coverage stated honestly as 0/0 post-adoption runs → 0/3 against the frozen ≥3 target with cost/duration missing by definition. The empty cohort is the true state: no post-adoption inline rows exist anywhere reachable (see escape-hatch audit below). |
| R3 | MET | INSUFFICIENT_EVIDENCE recorded (Solution header + R3 paragraph) with the named gap — zero attributable terminal inline runs — and the smallest bounded experiment: drive ≥3 real task-pipeline runs through the installed 0914 bridge on genuinely remaining work before 2026-10-06, then re-run this audit; retire the pilot claim without speed assertions if unmet at deadline. No graph edit: `git status` shows only the 0917 doc modified; branch diff vs merge-base a53751c9 touches 9 files (0916/0919 task docs, 2 app test files, 3 skill references, 1 plugin contract test) — `git diff --name-only <base>..HEAD |
| R4 | MET | Preservation verified by diff, not assertion: no task-pipeline YAML change on branch or working tree; `config/workflow-candidates.json` unmodified (working-tree diff empty; absent from branch diff) and content confirmed intact at line 6 = `"id": "history-anatomy-scope-inline"` with deadline 2026-10-07, createdAt 2026-09-23 (0920's candidate machinery untouched — Solution citation `:6` exact). No promotion claimed; nothing to retire (no candidate created); ADR-107 eligibility, proof freshness and reviewer isolation structurally untouched because no graph/config/runtime file changed. No new measurement service and no standing v2 YAML: branch adds zero source files (tests + skill-reference docs only) and zero YAML. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:59.825Z todo → blocked (system)
- 2026-09-23T19:13:57.447Z blocked → wip (system)
- 2026-09-23T19:24:56.530Z wip → testing (system)
- 2026-09-23T19:25:16.221Z testing → done (system)

