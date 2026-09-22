---
schema_version: 1
name: Establish the post-delivery workflow baseline and select a measured task-pipeline pilot
status: done
template: standard
created_at: 2026-09-22T00:44:35.777Z
updated_at: "2026-09-22T03:31:48.695Z"
feature_id: D62

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "6"
priority: P1
---

## 0912. Establish the post-delivery workflow baseline and select a measured task-pipeline pilot

### Background

Robin accepted the measured, incremental workflow-optimization recommendation on 2026-09-21 ("agree. then go ahead"). Start with one bounded evidence-and-pilot decision under existing owner D62. B6/B7/B8/G66 provide dispatch/session foundations; D3 provides reliability repairs; I31 investigations and corrective tasks 0906–0909 are recorded done. Recheck current receipts rather than treating historical handoff status as live truth.

I31/0905 had two docs-only pipeline runs, no terminal inline/fleet cohort and no usable cost joins. Its missing traces are not proof of a runtime defect. Preparation on 2026-09-21 queried the latest 100 workflow traces: 15 task-pipeline rows (2 done, 4 failed, 9 running), spanning multiple definition digests. This is a capped discovery sample, NOT a completion-rate denominator or post-delivery cohort. Some running rows may be stale; do not clean or relabel them during measurement.

One task owns the baseline, adoption comparison and concrete pilot decision because these use the same evidence and review context. Estimate: 6 hours. No phase split or separate telemetry system. Task-local AC is intentional: these research deliverables support D62 R4/R9/R13/R14 but are not new feature ship criteria. P owns reproduced runtime/receipt defects; E6 owns missing session/cost joins; I4/Superskill owns installed-role propagation. No duplicate implementation tasks before reproduction.

### Requirements

- [x] R1. Freeze a reproducible 14-day cohort ending at collection time, recording source commit, source-local CLI and runner versions, selection rules, run/definition identities, execution mode, task and change class, plus every exclusion and denominator.
- [x] R2. Measure complete-run and stage duration, agent invocations, fresh/reused sessions, gate repetitions, repair attempts, terminal state, verified outcome and operator interventions; keep tokens/USD and all missing measurements null with explicit coverage.
- [x] R3. Compare the actual source, project-registered/bundled and installed-adapter paths for task-pipeline and its inline driver, then inventory idea, batch and wrap-up adoption without modifying generated adapters.
- [x] R4. Reconcile apparent stale terminals and absent joins against persisted identities and task/verdict evidence; classify confirmed defects, adoption gaps and unknowns separately, with P/E6/I4/D62 ownership.
- [x] R5. Rank measured avoidable overhead and choose at most one task-pipeline pilot, or explicitly issue INSUFFICIENT_EVIDENCE with the smallest missing-evidence experiment; preserve verification, reviewer isolation and bounded recovery.
- [x] R6. Specify the pilot's exact target, before/after comparison, required regression checks, promotion/delete deadline and rollback; distinguish analytical replay projections from observed live improvement.
- [x] R7. Deliver a sanitized JSON baseline and readable decision report with a runnable integrity check, commands/provenance, limitations and one executable next action.

### Acceptance Criteria

- [x] AC1 — The cohort is reproducible and separates execution modes and change classes (req: R1)
- [x] AC2 — Timing reliability and cost metrics expose their actual denominators (req: R2)
- [x] AC3 — The executing workflow and installed guidance are compared to canonical contracts (req: R3)
- [x] AC4 — Every apparent defect is reproduced or explicitly retained as unknown under its existing owner (req: R4)
- [x] AC5 — The decision selects one supported pilot or names the evidence preventing selection (req: R5)
- [x] AC6 — A selected pilot has a falsifiable benefit criterion and preserves safety contracts (req: R6)
- [x] AC7 — Baseline artifacts and the next action are independently checkable (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T00:45:53.490Z

Decision source: Robin's 2026-09-21 acceptance of the measurement-and-pilot recommendation. Proceed within that scope without another planning confirmation.

One cohesive six-hour evidence deliverable under D62; no new feature or decomposition batch. Dependencies: I31 0903–0905 and corrective 0906–0909 are already done; refresh their status at execution. No outstanding semantic prerequisite to measurement. Actual workflow implementation remains conditional on the measured candidate; fleet/paid-run experiments must carry a finite scope and budget before dispatch.

A truthful INSUFFICIENT_EVIDENCE outcome completes the decision report only; it does not complete the pilot or justify broader migration. No percentage improvement, feature closure or runtime defect may be inferred from the capped preparation sample.

### Design

Approach: reuse source-local workflow trace/progress, existing action_runs/system_events projections, task show/verdict artifacts and history correlation. Consult scripts/commands/real-run-cost.ts and scripts/commands/workflow-promotion.ts before adding analysis logic. The latter measures real-run agent count/duration and projects graph deltas; it does not establish realized latency or quality gains.

Deliverables: docs/reports/i31/0912-workflow-baseline.json, 0912-workflow-baseline.md and one small 0912-check.ts following the existing report-check convention. JSON carries provenance, cohort selection, included/excluded runs, per-mode coverage, adoption rows, ranked findings and pilotDecision. No new runtime schema or design satellite: this changes no product boundary.

Collection: freeze end time before querying; include all qualifying runs in the 14-day window, or disclose truncation and refrain from population claims. Deduplicate by persisted run ID. Separate inline, subprocess pipeline and fleet using dispatch evidence, not run-name guesses. Keep lifecycle FSMs, dry runs and in-flight rows outside terminal execution denominators. Record docs-only versus code-changing diffs and definition/executor versions; never pool pre-fix and post-fix runs as one improvement comparison. Process exit, workflow terminal and verify PASS are distinct.

Coverage rule: a mode-specific candidate needs attributable real code-changing runs for that mode and enough repeated observations to distinguish overhead from one task's complexity. Report sample counts; do not invent a universal reliability percentage from small n. Generalizing to all workflows requires terminal evidence across all three modes and a recovery case. Missing fleet or cost evidence permits a narrower timing decision, not a fleet/cost claim.

Decision: rank repeated avoidable wall-clock/model time and operator work. Preserve task-local checks and existing feature-wide split, proof invalidation after mutations, reviewer/verify isolation, operator-decision boundaries and truthful terminal states. A pilot is eligible only with a concrete shared cause, observable saved work and unchanged correctness contracts. Before implementation, freeze a benefit target appropriate to the mechanism (for example elimination of one proven duplicate gate plus its measured duration); never choose a percentage after seeing results. Graph candidates use the existing promotion record and a calendar deadline set at candidate creation. Analytical savings must be labeled projected. One successful replay is not live proof.

Execution budget: at most 2 hours initial collection and 4 hours correlation/reporting; each external read bounded to 60 seconds, large scans checkpointed. At the boundary persist partial artifacts and an explicit evidence disposition. Do not launch paid agents or a live fleet merely to fill a denominator; specify the minimal controlled run if retained history is inadequate. mutationPolicy: none for runtime/source/workflows/config/installed adapters; requireDiff: false for measurement. Report/task artifacts are the deliverable. No workflow cleanup, status auto-closure, scheduler, public verb or new dependency.

Rejected: blanket YAML rewrite, new telemetry plane, docs-only tests used to justify source-check removal, cost nulls treated as zero, speculative P fixes, separate tasks for each metric. This single deliverable is reviewed together; later implementation is specified only once a concrete pilot is selected.

### Plan

1. Recheck feature/task receipts and current Git state; freeze the evidence window and provenance. Read I31 reports and D62 promotion/trace contracts.
2. Collect trace summaries and details with bounded source-local CLI calls; join task/verdict and changed-file evidence. Persist exclusions and unknowns before computing metrics.
3. Compare actual workflow resolution and installed adapter semantics with canonical source; record exact paths, versions and hashes without writing outside the project.
4. Attribute timings, repeated gates, sessions and recovery; correlate available history using existing read surfaces. Do not mutate/import a live history DB without following its backup contract.
5. Rank findings and select one eligible pilot or record INSUFFICIENT_EVIDENCE; write its bounded next experiment and exact owner. Keep planning, batch and wrap-up migration conditional on pilot evidence.
6. Add the smallest runnable integrity check: duplicate IDs, count/denominator consistency, nonnegative durations, null/zero distinction, supported references and truthful decision readiness. Run it against valid data and deliberately invalid in-memory cases.
7. Run task structural checks and the applicable report validation, then the required task/feature gates during execution; record actual verify evidence through the harness. Leave a concrete next action, without claiming the pilot implemented.

### Solution

Delivered the three named artifacts under `docs/reports/i31/` — a measurement-only pass (mutationPolicy honored: no runtime/source/workflow/config/installed-adapter mutations, no live-DB writes, main-checkout trace DB read via read-only sqlite3 + source-local CLI only). All implementation changes are new files; the only existing-file touches are tsdoc comment additions in `packages/contracts/src/fleet.ts` repairing a pre-existing gate failure on main (noted here for traceability; committed separately from this task's deliverables). Changes are left uncommitted; commits are owned by the driver.

## Change map

- `docs/reports/i31/0912-workflow-baseline.json:1` — sanitized baseline (R1–R7). Frozen window `2026-09-08T01:30:57Z..2026-09-22T01:30:57Z` declared before querying; provenance (source commit `dc109b0e42a4ca042a3dfc6c8f1036e3779f2abe`, CLI 0.3.91 source-local, runner versions, read-only evidence sources) at `docs/reports/i31/0912-workflow-baseline.json:10`; cohort with selection rules, exclusions, denominators and 4 in-window definition digests at `docs/reports/i31/0912-workflow-baseline.json:34`; 16 run rows with mode dispatch-evidence, task/change-class, durations (+bases), terminal evidence, repair/gate counts, null-not-zero cost at `docs/reports/i31/0912-workflow-baseline.json:109`; metrics incl. 0887 stage trace and session-coverage zeros at `docs/reports/i31/0912-workflow-baseline.json:570`; adoption rows (10/10 definitions digest-identical registered vs shared, installed script byte-identical, 0/15 inline runs with action rows) at `docs/reports/i31/0912-workflow-baseline.json:684`; 7 ranked findings at `docs/reports/i31/0912-workflow-baseline.json:815`; pilotDecision at `docs/reports/i31/0912-workflow-baseline.json:885`; executable nextAction at `docs/reports/i31/0912-workflow-baseline.json:922`; unknowns at `docs/reports/i31/0912-workflow-baseline.json:948`.
- `docs/reports/i31/0912-workflow-baseline.md:46` — readable decision report; its Decision section states the single selected pilot and the INSUFFICIENT_EVIDENCE rows with smallest experiments. Other sections: cohort/mode/change-class separation (Cohort), measured timing and honest null-cost gaps (Measured timing), adoption comparison across source/registered/installed surfaces (Adoption comparison), confirmed-defect vs adoption-gap vs unknown reconciliation (Reconciliation), limitations plus the one executable next action (Limitations).
- `docs/reports/i31/0912-check.ts:82` — integrity checker `validate()` per the existing report-check convention (0905 style): duplicate IDs, denominator vs actual rows (DB-terminal = `staleRow:false` vs out-of-DB-evidenced stale rows), digest-map coverage, nonnegative durations with basis, null-vs-zero, verdict/terminal evidence under the evidence root, adoption identity flags, pilot readiness (frozen target + calendar deadline + rollback + projection label), sparse delimitation. The deliberate-invalid harness is `docs/reports/i31/0912-check.ts:249` — 10 in-memory mutations, each required to be detected by `--self-test`.

## Key measured results

- Cohort: 16 task-pipeline rows; DB-terminal 6 (2 done / 4 failed); 10 rows left `running`, of which 7 carry out-of-DB terminal evidence (verdicts PASS, tasks 0849/0850/0853/0855/0887/0898/0906 done, G66 batch report) and 3 terminal outcomes remain unknown — inline runs never close their run rows (F1, reproduced; live corroboration at freeze: this run had 0 `action_runs` rows mid-flight, 1 written at its implement boundary after freeze) and ADR-117 emission is documented+scripted but never executed (F2, 0/15 inline runs; engine contrast 2888 rows/429 runs).
- Timing: 0887 5228 s (incl. one full-loss 1800 s test-fix timeout + 899 s retry), 0854 14514 s; tokens/USD null with denominator 0 (0/16 session joins; 4274 in-window history rows unjoinable). Wall-clock only.
- Adoption: all 10 definitions digest-identical between installed bundle and source today; one 2026-09-18 run resolved from the installed node_modules path (layer mislabeled `project`); installed driver doc differs only in 5 cosmetic command-name hunks.
- Decision: ONE pilot SELECTED — inline-driver terminal close + structured action emission on task-pipeline (existing ADR-117 contract; benefit target frozen as counts before implementation; deadline 2026-10-06; rollback = stop calling receipts); INSUFFICIENT_EVIDENCE with smallest experiments for gate-scope, cost, and fleet claims.

## Verification

- `bun run docs/reports/i31/0912-check.ts` → `CHECK-PASS: 16 runs (done:9 failed:4 nonterminal:3), 4 digests, 7 findings, pilot=SELECT (deadline 2026-10-06), 6 unknowns; ...` exit 0 (re-run after review-driven count corrections).
- `bun run docs/reports/i31/0912-check.ts --self-test` → `SELF-PASS: all deliberate invalid cases detected` exit 0.
- `bun apps/cli/src/index.ts task check 0912 --as todo` → `0912 (todo): PASS`.
- Review findings 1–4 and 6 (summary-count drift, stale anchors, fleet.ts tsdoc wording, MD taxonomy heading, stale status note) remediated pre-verify; finding 5 (resolver layer label recorded verbatim) retained as documented unknown.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | json window frozen before querying (`"14 UTC days: 2026-09-08T01:30:57Z .. 2026-09-22T01:30:57Z"`); sourceCommit `dc109b0e4`; cohort keys include counts/denominators/definitionDigests/exclusions/selection (docs/reports/i31/0912-workflow-baseline.json:34) |
| R2 | MET | 16 runs with durations+bases; tokens/USD null with denominator 0 (checker validates denominators, nulls, identity, evidence refs: CHECK-PASS output); metrics section at json:570 |
| R3 | MET | adoption section at json:684 — 10/10 definitions digest-identical registered vs shared; installed script byte-identical; 0/15 inline runs with action rows (identity flags validated by checker) |
| R4 | MET | findings[] at json:815 (7 items, confirmed-defect / adoption-gap separated); unknowns[] at json:948 (6 entries, 3 terminal-outcome); 10 staleRow=true vs 6 DB-terminal reconciled against terminalEvidence (13 runs carry evidence refs) |
| R5 | MET | pilotDecision at json:885 — exactly one SELECT; 3 insufficientEvidence entries each with smallest experiment (checker validates decision readiness) |
| R6 | MET | pilotDecision: deadline 2026-10-06, rollback ("driver stops calling the receipts; no schema/graph/config rollback"), 4 regression checks, projectionLabel marks ANALYTICAL PROJECTIONS vs live proof (json:885 block) |
| R7 | MET | three artifacts delivered; `bun run docs/reports/i31/0912-check.ts` → CHECK-PASS exit 0; `--self-test` → SELF-PASS (10/10 deliberate mutations detected); `spur task check 0912` → PASS; nextAction at json:922 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC7 | MET | command | `bun run docs/reports/i31/0912-check.ts` exit 0 CHECK-PASS; `--self-test` exit 0 SELF-PASS; `spur task check 0912` PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0912 (fresh review-only pass)

**Scope:** task 0912 diff — 3 new files `docs/reports/i31/0912-workflow-baseline.json`, `0912-workflow-baseline.md`, `0912-check.ts` + the task's Solution section; `packages/contracts/src/fleet.ts` tsdoc additions excluded from functional traceability, flagged as finding 3. Unrelated tree content not reviewed.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — no blocker/major findings; 3 minor + 3 advisory recorded below.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | Summary counts contradict the itemized `runs[]`: `runningWithOutOfDbTerminalEvidence: 8` / `runningUnknown: 2` vs actual 7 stale rows carrying out-of-DB terminalEvidence and 3 unknown-terminal rows (`unknowns[]` itself lists 3 terminal-outcome unknowns); F1's "9/10 rows updated_at == started_at" matches no measurement granularity (fresh DB re-measure: 8 exact-equal, 10 within 1 ms, 10 to-the-second); benefit-baseline "10/10 inline/batch rows non-terminal" vs 8 inline/batch + 2 mode-unknown rows. The checker validates none of these summary fields — the exact gap that let the drift through. Headline denominators 2/4/6/10 verified correct against the trace DB; the decision is unaffected (corrections strengthen F1 if anything). | `docs/reports/i31/0912-workflow-baseline.json:56-57`, `:821`, `:892` |
| 2 | P3 (minor) | usability | Solution change-map anchors are stale/drifted: `0912-workflow-baseline.json:978` is past EOF (956-line file; task-check L4 WARN), `:952` lands in limitations (actual nextAction :922), `0912-check.ts:230` points before the MUTATIONS table (actual :249); vicinity anchors drifted ~30 lines (metrics 600→570, adoption 714→684, findings 845→815, pilotDecision 915→885). | task 0912 Solution; `docs/reports/i31/0912-workflow-baseline.json:922`, `docs/reports/i31/0912-check.ts:249` |
| 3 | P3 (minor) | correctness | Out-of-scope pre-existing-gate repair, flagged per brief: tsdoc "layer defaults to project" is wrong — the handler computes `body.layer ?? (isProject ? 'project' : 'global')`, i.e. the fallback is conditional on where the executor is declared. Doc-only, but it misdocuments a public API type. | `packages/contracts/src/fleet.ts:131` vs `apps/server/src/modules/health/index.ts:508` |
| 4 | P4 (advisory) | correctness | F2 is `class: "adoption-gap"` in JSON but listed under the "Confirmed defects" heading in the MD — a hand-duplicated taxonomy surface drifted from the JSON SSOT (substance identical: reproduced, owner D62). | `docs/reports/i31/0912-workflow-baseline.json:830` vs `0912-workflow-baseline.md` Reconciliation |
| 5 | P4 (advisory) | correctness | `resolutionSurfacesInWindow` records this run's resolution layer as `project` for a config/workflows path that today's resolver reports as `shared` — the same label≠path pattern the artifact itself flags as F4 (ce44b029), recorded verbatim from the receipt without reconciliation. Post-freeze live note: 1 `action_runs` row (implement, created at completion 2026-09-22T02:00:10Z) now exists in the worktree DB — the frozen "0 rows mid-flight" snapshot was accurate at freeze; per-boundary and terminal-close emission are still absent, consistent with the pilot rationale. | `docs/reports/i31/0912-workflow-baseline.json:776`, `:97-103` |
| 6 | P4 (advisory) | usability | Solution's "Status left untouched (todo)" is stale at review time (todo → wip at 2026-09-22T02:00:08Z per task history). | task 0912 Solution |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `0912-workflow-baseline.json:8-107` — source commit verified equals HEAD `dc109b0e4`; fresh DB recount: 16 task-pipeline rows = 2 done / 4 failed / 10 running (exact match); per-run mode + dispatch evidence; exclusions and denominators explicit |
| R2 | MET | durations carry per-run basis; 0887 stage-trace arithmetic re-verified (action sum 4008.4 s vs 5228 s wall → ≈1220 s dispatch overhead); tokens/USD null with denominator 0 and all-history scope labeled; checker enforces null-not-zero |
| R3 | MET | all 10 definition digests recomputed via source-local `workflow list --json` — exact match; all 10 source↔installed-bundle files byte-identical; `inline-run-setup.ts` cmp-identical; no generated adapter modified (diff = 3 new files + task md + fleet.ts comments) |
| R4 | MET | F1/F2 corroborated by fresh read-only DB reads (all 15 non-engine cohort runs: 0 action_runs rows; engine contrast 2888 rows / 429 runs, exact); confirmed-defect / adoption-gap / unknown classified with owners; 6 unknowns retained, not relabeled |
| R5 | MET | exactly one pilot SELECT; 3 INSUFFICIENT_EVIDENCE areas each with smallest experiment + owner; verify gates, reviewer isolation and bounded recovery preserved in regressionChecks |
| R6 | MET | benefit target frozen as counts before implementation; deadline 2026-10-06 = freeze + 14 days (verified); rollback = driver stops calling receipts; analytical projections labeled, live claim requires ≥3 terminal inline runs |
| R7 | MET | checker reproduced: CHECK-PASS exit 0 and SELF-PASS with all 10 deliberate mutations detected (exit 0); next action executable (`workflow trace --last 20 --json` ran, exit 0); limitations + sparse-baseline delimitation present |

| AC | Status | Evidence |
|-----|--------|----------|
| AC1 | MET | modes engine/batch/inline/unknown separated with dispatch evidence; change classes code/docs/batch-verification/dispatch-error; 4 in-window digests, no cross-digest pooling |
| AC2 | MET | per-run duration basis; cost nulls expose denominator 0; aggregate explicitly scoped all-history (682,181 rows), never as 14-day results |
| AC3 | MET | registered vs shared digests + byte comparisons + installed-plugin doc diff (emission contract present in both copies) |
| AC4 | MET | F1/F2 reproduced live and from DB; F3–F7 retained with owners + smallest experiments; 6 unknowns explicit |
| AC5 | MET | one supported pilot selected; remaining claims name the preventing evidence + smallest experiment |
| AC6 | MET | falsifiable frozen counts target; regression checks preserve gates, reviewer isolation, mutationPolicy none |
| AC7 | MET | this review independently re-derived cohort counts, digest equality, engine contrast, verdict artifacts and next-action executability |

##### SECUA + Architecture Notes

- Security: read-only DB contract honored (`sqlite3 -readonly` only; no writes observed); checker is pure file-read + existsSync, no shell/eval; no secrets in artifacts (local paths consistent with the 0905 convention).
- Efficiency: checker is O(n) over 16 runs; bounded-read collection consistent with the design budget; no findings.
- Architecture: strong depth — `validate()` is a pure (doc, evidenceRoot) function with all invariants centralized, driven by a 10-mutation adversarial self-test table (all detected, reproduced by this review). Two deepenings: (1) add the missing summary-count validations (out-of-DB-evidenced count and unknown-terminal count derived from `runs[]`) — would have caught finding 1; (2) replace line-number anchors in the Solution change map with stable JSON pointers (`$.unknowns`) or generate them at write time — line anchors rot structurally (finding 2), and the MD's hand-duplicated F2 classification (finding 4) should be projected from the JSON SSOT.

**Next:** route findings 1–3 to `/sp-dev-verify --fix` (or sp-code-implementation): correct the three summary counts and F1's phrasing, regenerate the Solution anchors, and fix the fleet.ts tsdoc wording to "defaults to the layer where the executor is declared (project if declared there, else global)"; accept or fold findings 4–6 into the same pass. Gate not blocked.


#### Review addendum — post-remediation refresh (2026-09-22, fresh session)

**Verdict:** still PASS. Bounded refresh confirming only the remediations of prior findings 1–4 and 6; the full task was not re-reviewed. All five checks CONFIRMED, none REGRESSED.

1. CONFIRMED — summary counts corrected: `runningWithOutOfDbTerminalEvidence: 7` / `runningUnknown: 3` (`docs/reports/i31/0912-workflow-baseline.json:56-57`), consistent with `runs[]` (7 stale rows with out-of-DB `terminalEvidence.kind`; exactly 3 terminal-unknown rows: 5b9072aa, ce44b029, e021bbc1; 7+3=10 = runningAtFreeze) and with `unknowns[]` (exactly 3 terminal-outcome unknowns of 6 entries). F1 observation states all-10-rows-within-1ms (8 exact) / 7 with out-of-DB evidence / 3 unknown (`:821`); benefit target reads "all 8 in-cohort inline/batch rows non-terminal (2 further running rows are mode-unknown and excluded)" (`:892`), arithmetically consistent (7 inline + 1 batch running = 8; +2 mode-unknown = 10).
2. CONFIRMED — MD F1 bullet and benefit-target bullet match the JSON SSOT (`docs/reports/i31/0912-workflow-baseline.md:37`, `:50`); reconciliation lead-in now "Confirmed defects & adoption gaps" (`:36`).
3. CONFIRMED — `packages/contracts/src/fleet.ts:131` tsdoc now reads "layer falls back to where the executor is declared (project when the request targets a project, else global)"; no "defaults to project" text remains in `packages/contracts/src/` or the health module; matches `apps/server/src/modules/health/index.ts:505` (`body.layer ?? (isProject ? 'project' : 'global')`).
4. CONFIRMED — Solution change-map anchors land exactly on their targets: json:570 `"metrics"`, json:684 `"adoption"`, json:815 `"findings"`, json:885 `"pilotDecision"`, json:922 `"nextAction"`, json:948 `"unknowns"`, `docs/reports/i31/0912-check.ts:249` `const MUTATIONS`; the stale "Status left untouched (todo)" note is removed (Verification records finding 6 remediated pre-verify).
5. CONFIRMED — `bun run docs/reports/i31/0912-check.ts` → `CHECK-PASS: 16 runs (done:9 failed:4 nonterminal:3), 4 digests, 7 findings, pilot=SELECT (deadline 2026-10-06), 6 unknowns; ...` exit 0.

Finding 5 (P4 advisory — resolver layer label recorded verbatim) remains a documented unknown; unchanged by this refresh.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T00:46:22.119Z backlog → todo (system)
- 2026-09-22T02:00:08.693Z todo → wip (system)
- 2026-09-22T03:13:49.493Z wip → testing (system)
- 2026-09-22T03:14:08.463Z testing → done (system)

