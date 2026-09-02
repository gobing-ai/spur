---
schema_version: 1
name: "Synthesize the task-ready workflow upgrade strategy"
status: done
template: meta
created_at: 2026-09-02T03:05:58.141Z
updated_at: "2026-09-02T19:14:53.434Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "strategy", "handoff"]
dependencies: ["0732"]
---

## 0733. Synthesize the task-ready workflow upgrade strategy

### Background

D8 ends when the operator can approve a concrete workflow upgrade strategy without re-reading the investigation corpus. Synthesize the completed ADR, baseline, cost, fit, and prototype evidence into a small option set and a task-ready recommendation; do not create implementation tasks before the approval decision.

### Requirements

- [x] R1. Produce two or three evidence-compatible strategy options with trade-offs, confidence, complexity, blast radius, affected ADRs, and a clear recommendation; deletion/demotion and stabilization-only must be considered before new routing machinery.
- [x] R2. Include explicit matrices for workflow deployment role and keep/simplify/demote/retire disposition; mandatory/proportional/optional/remove gates; reference snapshot/temporary waiver/remove baseline semantics; and deterministic capability/script ownership.
- [x] R3. Put a minimal stabilization slice before optimization: one shared definition load/resolve/preflight seam; one run/continue execution harness; correct config/default-kind/action options; exact source/digest resume binding; paused progress; safe path/run-id confinement; fail-closed proof/fresh artifacts; and repair/removal of impossible nested composition.
- [x] R4. Define the target proportional-routing contract as a closed route table with an immutable safety floor, unknown-to-safety behavior, bounded observable reasons, exact proof, rollback, and budgets that are either evidence-backed or explicitly unestablished under 0730's sufficiency rule.
- [x] R5. Decide whether each baseline and the prompt-level inline interpreter needs to exist. Any retained mechanism has a single owner, executable effect/parity check, lifecycle/removal criteria, maintenance budget, and no inert fields; otherwise remove or demote it.
- [x] R6. Draft the ADR keep/amend/supersede/retire matrix, including ADR-102 and ADRs 094-100 derived-doc drift, plus authority-first updates for architecture, design, observability, composition, and surface governance. Do not mutate authority docs before approval.
- [x] R7. Provide cohesive implementation slices in surrounding-workflow-first order with `task-pipeline` last. Each slice names dependencies, owner, changed surfaces, reproducing/regression/verification checks, rollback boundary, observability, and any public-surface consent gate.
- [x] R8. Specify the minimal optional workflow-version contract for both dialects: behavior-neutral non-empty opaque string; absent=`unversioned`; present=`explicit(<literal>)`; empty-value diagnostic; source/digest/pause-resume propagation; bundled/project precedence; in-flight compatibility; rollout/rollback; and evidence required before a future-major mandate. Do not add a registry until behavior dispatch requires one.
- [x] R9. Save a dated plan with a non-trivial Design Summary and self-review it for evidence links, placeholders, contradictions, scope creep, ambiguous handoff, and unproven controls. Record the operator's exact disposition: approval freezes the strategy and unlocks later implementation-task creation; rejection keeps D8 open with requested revisions.
- [x] R10. Publish the durable findings artifact at `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` — the task-ready strategy body for operator review. The task Solution summarizes and links it; the artifact is the reviewable deliverable.

### Acceptance Criteria

- [ ] The strategy is reviewable without loading predecessor task bodies, while every material claim links to its source task evidence.
- [ ] The recommendation prioritizes correctness and verified outcomes, then human attention, fresh premium tokens per verified PASS, wall-clock, and maintenance simplicity.
- [ ] No option treats timeout fields, proof bindings, baselines, composition snapshots, static query counts, or consolidated logs as effective controls without an executable test.
- [ ] Stabilization repairs one shared root-cause seam per cross-surface defect before proportional optimization or migration.
- [ ] Baseline and inline-interpreter recommendations explicitly choose keep/simplify/replace/remove and include effect/parity, lifecycle, observability, rollback, and sunset criteria.
- [ ] Implementation slices are executable after approval, expose dependencies and consent gates, start with surrounding workflows, and migrate `task-pipeline` last.
- [ ] The optional-first version contract preserves unversioned files, exposes literal plus digest, handles paused/in-flight runs, and defines objective evidence—not aspiration—for any future-major mandate.
- [ ] The dated plan has no placeholders or hidden operator decisions, and records approval/rejection consequences explicitly.
- [ ] Project/Workspace/Inbox/Teams consolidation, a second engine/DSL/version registry, production workflow mutation, and unapproved public CLI changes remain out of scope.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Treat the dated plan as the decision packet: compact evidence tables, two or three materially distinct options, one recommendation, a stabilization-first slice graph, and a hard operator-disposition gate. Reference predecessor evidence rather than copying it. Prefer deleting redundant workflow machinery over synchronizing multiple interpreters.

### Plan

- [ ] Load predecessor Solutions and resolve contradictory claims against their executable evidence.
- [ ] Generate and score two or three options, including deletion/demotion and stabilization-only.
- [ ] Write the stabilization prerequisites, proportional contract, matrices, and evidence-qualified budgets.
- [ ] Define optional-version propagation and future-major evidence threshold.
- [ ] Build surrounding-first implementation slices, ADR/doc map, rollback, and consent gates.
- [ ] Self-review the dated plan and record the operator's approval or requested revision.
- [ ] Publish `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Deliverable published: `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (R10) — the task-ready D8 strategy body for operator review.

**Recommendation (R1, plan §0-§1):** Option A — stabilize shared seams → pilot proportional gates on surrounding workflows → migrate `task-pipeline` last. Option B (stabilize+measure only) is the fallback; Option C (direct task-pipeline build + version registry) is rejected (F-5/F-7/F-8 make task-pipeline non-executable; registry has zero consumers).

**Matrices (R2, plan §2):** deployment role × keep/simplify/demote/retire (11 workflows, `docs/inventory/d8-0731-workflow-fit-classification.md` §2/§4); gate classification mandatory/proportional/optional/remove; baseline semantics reference/temporary-waiver/remove (`docs/inventory/d8-0729-workflow-contract-inventory.md` §C + ADR-093); capability/script ownership (0729 §G).

**Stabilization slice (R3, plan §3):** one root-cause seam per cross-surface defect: F-1 timeout key (`command-gate.ts:157`), F-2 nested feature-dev review, F-3 spurConfig (`apps/cli/src/commands/workflow.ts:253-286`), F-4 continue-drift (`workflow-service.ts:1007,1076`), F-5 fail-open proof (`proof-input-fingerprint.ts:99-118`), F-6 run-id, F-7 suppressed lookup, F-8 stale expectFile, F-9 decorative binding, F-11 budget no-op, F-14 dry-run smoke; corpus regen + ADR-093 waiver migration (Decision 8); budgets FIX-not-raise (Decision 11); escalation-noise fix.

**Proportional contract (R4, plan §4):** closed route table + immutable safety floor + unknown-to-safety + bounded reasons + exact proof + rollback; budgets explicitly unestablished under 0730 §G sufficiency rule (0 real terminal runs).

**Baseline + inline-interpreter decisions (R5, plan §5):** every baseline keep/simplify/replace/remove decided; inline driver kept with single owner + executable parity check + A3 removal gate (it is the only real-work execution path today, `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §F).

**ADR matrix (R6, plan §6):** keep/amend/supersede/retire incl. ADR-102 stale-doc (docs/04 anchor, `docs/04_DESIGN.md:2358` mislabeled ADR-101/task 0706) and ADRs 094-100 derived-doc drift (`docs/03_ARCHITECTURE.md:1358` "not yet built" while 0703-0712 done). No authority doc mutated.

**Slices (R7, plan §7):** S0 shared-seam stabilization → S1 doc/baseline repair → S2 inline parity → S3 surrounding pilots (wrapup + task-lifecycle) → S4 optional version contract → S5 task-pipeline LAST. Each names dependencies, owner, surfaces, checks, rollback, observability, consent gate.

**Version contract (R8, plan §8):** optional-first; absent=`unversioned`, present=`explicit(<literal>)`, empty=diagnostic; source/digest/pause-resume propagation; project-first precedence; no registry; future-major mandate needs objective evidence (a consumer branching on version or a real drift incident) — neither exists.

**Self-review (R9, plan §9):** evidence links, no placeholders, contradictions resolved, scope boundaries, explicit disposition gate (approval freezes strategy + unlocks task creation; rejection keeps D8 open). Open operator decisions D1-D8 enumerated with defaults.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Plan §0-§1 (`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md:18-67`): Options A (stabilize → pilot surrounding → task-pipeline last), B (stabilize+measure only), C (direct task-pipeline + registry, rejected). Each names trade-offs, confidence, complexity, blast radius, affected ADRs. Deletion/demotion (inert baseline fields, pipeline-budgets no-op, docs/03 §24 dead framing, nested feature-dev review) and stabilization-only (Option B) are considered BEFORE new routing machinery (AC). Recommendation = Option A, with B as automatic fallback. |
| R2 | MET | Plan §2 (`:68-124`): §2.1 deployment role × keep/simplify/demote/retire disposition matrix (11 workflows, source 0731 §4); §2.2 gate classification mandatory/proportional/optional/remove (source 0729 §F, 0730 §H, 0732 §2); §2.3 baseline semantics reference/temporary-waiver/remove (source 0729 §C, ADR-093); §2.4 deterministic capability/script ownership (source 0729 §G). |
| R3 | MET | Plan §3 (`:125-151`): 8 R3 seams (S1-S8) map to 13 seam-repair rows + 3 baseline/ops rows, one shared root-cause seam per cross-surface defect (F-1 timeout key `command-gate.ts:157`, F-2 nested review `feature-dev.yaml:156-169`, F-3 spurConfig `workflow.ts:253-286`, F-4 continue-drift `workflow-service.ts:1007,1076`, F-5 fail-open proof `proof-input-fingerprint.ts:99-118`, F-6 run-id, F-7 suppressed lookup, F-8 stale expectFile, F-9 decorative binding `run-artifact.ts:88-101`, F-11 budget no-op, F-14 dry-run smoke) — all anchored to 0729 §F. Stabilization precedes any proportional optimization (ordering constraint stated). |
| R4 | MET | Plan §4 (`:152-167`): closed route table (0732 §2), immutable safety floor (proof-bracket guards, budget-unverifiable fail-closed, reviewer independence, run-id confinement — 0730 §H), unknown-to-safety, bounded observable reasons (per-run `.spur/run/<runId>-reason.txt`), exact proof (transition_runs + run artifacts + definitionDigest stamp), rollback (per-slice isolated). Budgets explicitly unestablished under 0730 §G sufficiency rule (0 real terminal runs, 0 run-scoped cost mappings, defective verified-outcome binding) — `:162`. |
| R5 | MET | Plan §5 (`:168-192`): §5.1 per-baseline keep/simplify/replace/remove with effect/parity check, lifecycle/sunset, maintenance budget, inert-fields audit (matches 0729 §C dispositions); §5.2 inline-interpreter decision = keep with single owner (spur-dev/runall driver) + executable parity check + A3 removal gate + maintenance budget + no inert fields (source 0730 §F: inline driver is the only real-work execution cohort today). |
| R6 | MET | Plan §6 (`:193-233`): ADR keep/amend/supersede/retire matrix incl. ADR-102 stale-doc (`docs/04_DESIGN.md:2358` mislabeled ADR-101/task 0706; detail pointer `04 §agent-capability-attestation` unresolvable) and ADRs 094-100 derived-doc drift (`docs/03_ARCHITECTURE.md:1358` "not yet built" while 0703-0712 done; ADRs 094-100 0× in docs/04) — both anchors re-read live this verify. Authority-first update order (architecture → design → observability → composition → surface governance) in S1. No authority doc mutated (git status clean for docs/00, 03, 04, 99, design/, config/workflows/, plugins/sp/). |
| R7 | MET | Plan §7 (`:234-301`): six slices S0-S5, each with dependencies, owner, changed surfaces, checks, rollback boundary, observability, and public-surface consent gate. Surrounding-workflow-first (S3 pilots wrapup-pipeline + task-lifecycle); `task-pipeline` LAST in S5. Consent gates: S1 (surface inventory + corpus/baseline regen), S3 (surrounding routing), S5 (task-pipeline routing); S0/S2/S4 internal/behavior-neutral. |
| R8 | MET | Plan §8 (`:302-320`): absent=`unversioned` (all 11 today, 0731 §1), present=`explicit(<literal>)` opaque behavior-neutral, empty-value diagnostic (`minLength: 1`), source/digest propagation (folded into `computeDefinitionDigest`, `composition-baseline.ts:110` — version-only edit changes digest, proven 0732 §7), pause-resume subsumed by F-4 continue-digest fix (S0), bundled/project precedence unify (project-first; `make-lifecycle-adapter.ts:24-34` bundled-first divergence), in-flight compatibility (version not a dispatch key), rollout/rollback (additive/removable), future-major mandate = objective evidence only (consumer branching on version or real drift incident — neither exists, 0729 §H). No registry. |
| R9 | MET | Plan §9 (`:321-356`): §9.1 non-trivial Design Summary (decision surface: option, 4 matrices, 8 seams, contract, baseline+inline decisions, ADR map, 6 slices, version contract); §9.2 self-review covers evidence links, no placeholders, contradictions resolved (cohort 67/68/69→74 sequential DB states; version-digest-accepted; safety:conflict fixture wart), scope boundaries, ambiguous handoff (disposition gate = hard handoff), unproven controls (budgets explicitly unestablished); §9.3 D1-D8 open operator decisions each with a default. Operator disposition gate recorded: approval freezes strategy + unlocks S0-S5 task creation; rejection keeps D8 open with requested revisions (`:14`, `:353`). |
| R10 | MET | Durable artifact `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` exists (366 lines, `wc -l` verified), is the task-ready strategy body, and is linked from the task Solution ("Deliverable published: ... (R10)"). Dated plan; format matches prior dated plans in `docs/plans/`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [doc-only] The strategy is reviewable without loading predecessor task bodies, while every material claim links to its source task evidence. | MET | static-ref | Plan `:8-12` input-evidence header names all four authority artifacts (0729 §F/§C/§G/Decision 8/11; 0730 §F/§G/§H; 0731 §2/§4/§5/§6; 0732 §2/§5/§7/§8); every §1-§8 section cites its source artifact by name — no predecessor task body must be loaded. |
| [doc-only] The recommendation prioritizes correctness and verified outcomes, then human attention, fresh premium tokens per verified PASS, wall-clock, and maintenance simplicity. | MET | static-ref | Plan §0 (`:20`) and Option A trade-offs (`:34`): correctness & verified outcomes → human attention → fresh premium tokens per verified PASS → wall-clock → maintenance simplicity, exactly the AC ordering. Option B (measure-only) is the lower-priority fallback; Option C rejected. |
| [doc-only] No option treats timeout fields, proof bindings, baselines, composition snapshots, static query counts, or consolidated logs as effective controls without an executable test. | MET | static-ref | Plan §0 (`:20`), §4 item 7 (`:162`), §9.2 Unproven controls (`:338`): every such mechanism is either fixed to have an executable test (S0 seam repairs) or explicitly not counted; budgets explicitly unestablished under 0730 §G (no budget is proposed as a gate ceiling). |
| [doc-only] Stabilization repairs one shared root-cause seam per cross-surface defect before proportional optimization or migration. | MET | static-ref | Plan §3 (`:125-151`): 8 R3 seams S1-S8 mapped to root-cause seam repairs (one shared seam per cross-surface defect, not per-caller patches); ordering constraint (`:150`) lands repairs BEFORE any proportional gate (0732 §8 constraints). |
| [doc-only] Baseline and inline-interpreter recommendations explicitly choose keep/simplify/replace/remove and include effect/parity, lifecycle, observability, rollback, and sunset criteria. | MET | static-ref | Plan §5 (`:168-192`): each baseline row has Decision (keep/simplify/fix/replace/remove), Effect/parity check, Lifecycle/sunset, Maintenance budget, Inert fields? — full 5-column coverage; §5.2 inline driver keep with owner, parity check, removal gate (sunset at A3), maintenance budget, no inert fields. |
| [doc-only] Implementation slices are executable after approval, expose dependencies and consent gates, start with surrounding workflows, and migrate `task-pipeline` last. | MET | static-ref | Plan §7 (`:234-301`): each slice names dependencies, owner, changed surfaces, checks, rollback, observability, consent gate; S3 pilots surrounding workflows first; `task-pipeline` migration is S5 (LAST); consent gates on S1/S3/S5. |
| [doc-only] The optional-first version contract preserves unversioned files, exposes literal plus digest, handles paused/in-flight runs, and defines objective evidence—not aspiration—for any future-major mandate. | MET | static-ref | Plan §8 (`:302-320`): absent=`unversioned` preserved; present=`explicit(<literal>)` + digest (folded into `computeDefinitionDigest`, `composition-baseline.ts:110`); pause-resume handled via F-4 continue-digest fix (S0, subsumes version drift); in-flight compatibility (no dispatch on version); future-major mandate = objective evidence only (consumer branching on version or real drift incident — neither exists, 0729 §H). |
| [doc-only] The dated plan has no placeholders or hidden operator decisions, and records approval/rejection consequences explicitly. | MET | static-ref | Plan §9.2 (`:327-339`): "Placeholders: none — every table fully populated; unknowns named as unknowns"; §9.3 D1-D8 open decisions each enumerated with an explicit default (no hidden decisions); disposition gate (`:14`, `:353`) records approval freezes + unlocks task creation / rejection keeps D8 open with revisions. |
| [doc-only] Project/Workspace/Inbox/Teams consolidation, a second engine/DSL/version registry, production workflow mutation, and unapproved public CLI changes remain out of scope. | MET | static-ref | Plan §9.2 Scope creep (`:335-336`): explicitly excluded — consolidation, second engine/DSL/version registry, production workflow mutation (all post-approval with consent gates), unapproved public CLI changes. Git status confirms no config/workflows/, apps/cli/, or authority-doc mutation by this task. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Scope:** WBS 0733 diff (R10 durable plan deliverable) — strategy plan cross-checked against the four authority artifacts (0729 inventory, 0730 measurement, 0731 fit classification, 0732 prototype) plus live `file:line` anchors.
**Dimensions:** functional (R1-R10), correctness, architecture, evidence quality.
**Verdict:** PASS

### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P3 | architecture | R6 ADR matrix does not reconcile the ADR-094 / ADR-102 relationship: both ADRs cover the same task-0706 capability-attestation work (same date 2026-08-29); ADR-102 ("Constrained Agent Stages Attest Executor Capabilities Before Spawn") is the concrete contract refining ADR-094's design principle ("Constrained Agent Stages Require Host-Enforced Capability Attestation"). A keep/amend/supersede/retire matrix should surface a 094→102 supersede-or-duplicate decision; the plan treats them as independent (094 keep, 102 amend-docs) with no relationship noted. Does not block the strategy; should be resolved when S1 writes the docs-fix task. | `docs/00_ADR.md:1917` (094), `docs/00_ADR.md:2023` (102); plan `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md:193-233` |
| 2 | P3 | correctness | Option "Affected ADRs" summary lines underreport the §6 matrix amends: Option A lists amend 069/071/093/099/100/102 (6) but the §6 matrix amends 8 (also 051 surface governance, 098 escalation exclusion, both in S0/S1); Option B lists amend 069/093/100/102 (4) but as A1-only should include 051/071/098/099 (all land in S0/S1). An operator comparing options gets an incomplete affected-ADR set. | plan `:42` (A), `:50` (B) vs `:193-233` (matrix) |
| 3 | P4 | correctness | §2.2 ADR-098 row says "fired for all 65 dry probes (noise)" but 0730 §F documents 59 packets for the 65-run dry sweep (plan §3 itself correctly says 59). Internal count imprecision. | plan `:87` vs `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:98` |
| 4 | P4 | correctness | §3 note assigns the escalation-noise repair ("final 3 rows … land in slice S1") but S0's Changed surfaces lists "escalation emission" and S1's list does not — slice-assignment inconsistency. | plan `:127` vs `:242` |
| 5 | P4 | architecture | F-10 (whole-tree Solution attribution, S3 severity in 0729 §F) is not addressed in the R3 table or any slice. Defensible — not one of the 8 R3-required seams — but the defect-register cross-reference is incomplete for a "task-ready" packet. | 0729 `docs/inventory/d8-0729-workflow-contract-inventory.md` §F-10; plan §3 `:125-150` |
| 6 | P4 | correctness | S0 "Consent gate: none public" immediately followed by "corpus regeneration is a baseline change → operator consent (Decision 8)" — framing tension (substance correct, wording self-contradictory). | plan `:247` |
| 7 | P4 | correctness | Task Testing states plan "created (356 lines)" but the file is 366 lines. | task `:96`; `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (wc -l = 366) |
| 8 | P4 | architecture | S0 Changed surfaces omits the R8 source-precedence unify (`make-lifecycle-adapter.ts` bundled-first), which §8 explicitly attributes to S0 — slice surface list incomplete for the precedence fix. | plan `:242` (S0) vs `:307` (R8 precedence row) |

### Functional Traceability (R1-R10)

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | §0-§1: options A/B/C with trade-offs/confidence/complexity/blast radius/affected-ADRs; deletion+stabilization-only considered (B) before routing (A/C); C rejected. Distinctness confirmed (A=full sequence, B=A1-only, C=direct-build). A consistent with 0731 §6 + 0732 §8. |
| R2 | MET | §2.1 roles×dispositions (11 workflows, matches 0731 §4); §2.2 gate classes mandatory/proportional/optional/remove; §2.3 baseline reference/temporary-waiver/remove; §2.4 capability/script ownership. |
| R3 | MET | §3 eight seams S1-S8 map to 13 seam-repair rows + 3 baseline/ops rows; root-cause one-seam-per-defect; ordering constraint honored. |
| R4 | MET | §4 closed route table, immutable safety floor, unknown-to-safety, bounded reasons, exact proof, rollback, evidence-qualified budgets (0730 §G NOT MET stated). |
| R5 | MET | §5.1 per-baseline keep/simplify/replace/remove with effect/parity, lifecycle/sunset, maintenance budget, inert-fields audit; §5.2 inline driver keep with owner+parity check+removal gate. |
| R6 | MET | §6 keep/amend/supersede/retire incl. ADR-102 stale-doc + ADRs 094-100 derived-doc drift + authority-first update order; no authority doc mutated (git status clean for docs/00-05, DESIGN, AGENTS). |
| R7 | MET | §7 six slices S0-S5, each with dependencies/owner/surfaces/checks/rollback/observability/consent gate; task-pipeline in S5 (LAST); consent gates on S1/S3/S5. |
| R8 | MET | §8 absent=unversioned, present=explicit(<literal>), empty=diagnostic, digest propagation (`composition-baseline.ts:110`), pause-resume subsumed by F-4 fix, project-first precedence unify, in-flight compat, rollout/rollback, future-major objective-evidence threshold, no registry. |
| R9 | MET | §9.1 Design Summary; §9.2 self-review (evidence links, no placeholders, contradictions reconciled incl. cohort 67/68/69→74 and version-digest-accepted and safety:conflict fixture wart); §9.3 D1-D8 open decisions with defaults; disposition gate explicit (approval freezes + unlocks tasks; rejection keeps D8 open). |
| R10 | MET | Deliverable published at `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (366 lines); Solution links it; references correct. |

### Spot-check evidence (fresh, this review)

- `docs/03_ARCHITECTURE.md:1358` = `## 24. Production Autonomy Contracts (accepted design — ADR-094–100; not yet built)` while tasks 0703-0712 are all `done` — drift claim real.
- `docs/04_DESIGN.md:2358` = `**Capability attestation (ADR-101, task 0706).**` — ADR-101 is "History Refresh Uses Process Isolation" (`docs/00_ADR.md:2005`); capability attestation is ADR-102 (`:2023`). Mislabel claim real. ADR-102 Detail pointer `04 Design §agent-capability-attestation` does not resolve (0 hits for that anchor in docs/04).
- ADRs 094-100 appear 0× in docs/04_DESIGN.md (ADR-101 3×), 1-2× each in docs/03_ARCHITECTURE.md — derived-doc drift claim real.
- F-1 `command-gate.ts:157` spreads `timeoutMs`; `@gobing-ai/ts-runtime/dist/process-executor.d.ts:58` declares `timeout?: number` — dead-timeout claim real.
- F-5 `proof-input-fingerprint.ts:99-118` returns `''` on every git failure path — fail-open claim real.
- F-9 `run-artifact.ts:88-101` echoes `proofBinding` into result data only, never validates — decorative-binding claim real.
- F-4 `workflow-service.ts:1007/1021/1076` — `continuePaused` re-resolves by name via `resolveWorkflowDefByName` with `validateSchema: false`, no digest comparison — real.
- R8 digests `3d5c4d42d…` (unversioned) vs `60fa187c2…` (explicit 1.2.3) match 0732 §5/§7 verbatim.
- Source precedence: `resolveWorkflowFile` (`workflow-service.ts:1690-1707`) project-first; `make-lifecycle-adapter.ts:24-34` bundled-first — divergence real.
- `regen-corpus-baseline` has no package.json entry (only `regen-composition-baseline` at `package.json:90`) — gap real.
- pipeline-budgets docs-pipeline still `modelQueries: 1` with `decision: null` — FIX correctly framed as a proposed S1 action, not claimed done.
- corpus-baseline 272 entries; composition-baseline carries the 6 inert per-workflow fields + `proofInputs` — baseline claims real.

### Residual Risk

- ADR-094/102 supersede-or-duplicate relationship (P3-1) and affected-ADR summary gaps (P3-2) should be resolved when S1 creates the authority/derived-doc repair tasks; neither blocks strategy approval.
- F-10 (whole-tree attribution) remains unowned by the plan — recommend an explicit in/out-of-scope line when implementation tasks are created.
- All R8/P2 claims verified against live sources; no unverified control is treated as effective (0730 §G "no budget" honored throughout).

### Disposition

**APPROVE.** No P1/P2 findings; all R1-R10 requirements met; drift claims verified against live `file:line` evidence; no authority doc mutated; plan is a clean draft decision packet with explicit consent gates. P3/P4 items are recorded for the S0/S1 implementation-task creation step, not gating.

### References

- Tasks 0729-0732 Solutions and Testing/Review evidence.
- `docs/00_ADR.md`; `docs/03_ARCHITECTURE.md`; `docs/04_DESIGN.md`; `docs/99_PROJECT_CONSTITUTION.md`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`; `docs/design/harness-surface-governance.md`.
- `config/workflows/`; `config/workflow-composition-baseline.json`; `config/corpus-baseline.json`; `config/plugin-scripts.json`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/`; `apps/cli/src/commands/workflow.ts`.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `scripts/commands/{real-run-cost,pipeline-budgets}.ts`.

### History

- 2026-09-02T18:57:43.683Z todo → wip (system)
- 2026-09-02T19:14:46.132Z wip → testing (system)
- 2026-09-02T19:14:53.434Z testing → done (system)
