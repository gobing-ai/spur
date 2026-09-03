---
schema_version: 1
name: "Synthesize the task-ready workflow upgrade strategy"
status: done
template: meta
created_at: 2026-09-02T03:05:58.141Z
updated_at: "2026-09-03T04:30:36.418Z"
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

- [x] The strategy is reviewable without loading predecessor task bodies, while every material claim links to its source task evidence.
- [x] The recommendation prioritizes correctness and verified outcomes, then human attention, fresh premium tokens per verified PASS, wall-clock, and maintenance simplicity.
- [x] No option treats timeout fields, proof bindings, baselines, composition snapshots, static query counts, or consolidated logs as effective controls without an executable test.
- [x] Stabilization repairs one shared root-cause seam per cross-surface defect before proportional optimization or migration.
- [x] Baseline and inline-interpreter recommendations explicitly choose keep/simplify/replace/remove and include effect/parity, lifecycle, observability, rollback, and sunset criteria.
- [x] Implementation slices are executable after approval, expose dependencies and consent gates, start with surrounding workflows, and migrate `task-pipeline` last.
- [x] The optional-first version contract preserves unversioned files, exposes literal plus digest, handles paused/in-flight runs, and defines objective evidence—not aspiration—for any future-major mandate.
- [x] The dated plan has no placeholders or hidden operator decisions, and records approval/rejection consequences explicitly.
- [x] Project/Workspace/Inbox/Teams consolidation, a second engine/DSL/version registry, production workflow mutation, and unapproved public CLI changes remain out of scope.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Treat the dated plan as the decision packet: compact evidence tables, two or three materially distinct options, one recommendation, a stabilization-first slice graph, and a hard operator-disposition gate. Reference predecessor evidence rather than copying it. Prefer deleting redundant workflow machinery over synchronizing multiple interpreters.

### Plan

- [x] Load predecessor Solutions and resolve contradictory claims against their executable evidence.
- [x] Generate and score two or three options, including deletion/demotion and stabilization-only.
- [x] Write the stabilization prerequisites, proportional contract, matrices, and evidence-qualified budgets.
- [x] Define optional-version propagation and future-major evidence threshold.
- [x] Build surrounding-first implementation slices, ADR/doc map, rollback, and consent gates.
- [x] Self-review the dated plan and record the operator's approval or requested revision.
- [x] Publish `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Deliverable published: `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (R10) — the task-ready D8 strategy body for operator review.

**Recommendation (R1, plan §0-§1):** Option A — stabilize shared seams → pilot proportional gates on surrounding workflows → migrate `task-pipeline` last. Option B (stabilize+measure only) is the fallback; Option C (direct task-pipeline build + version registry) is rejected (F-5/F-7/F-8 make task-pipeline non-executable; registry has zero consumers).

**Matrices (R2, plan §2):** deployment role × keep/simplify/demote/retire (11 workflows, `docs/inventory/d8-0731-workflow-fit-classification.md` §2/§4); gate classification mandatory/proportional/optional/remove; baseline semantics reference/temporary-waiver/remove (`docs/inventory/d8-0729-workflow-contract-inventory.md` §C + ADR-093); capability/script ownership (0729 §G).

**Stabilization slice (R3, plan §3):** one root-cause seam per cross-surface defect: F-1 timeout key (`packages/app/src/workflow/actions/command-gate.ts:157`), F-2 nested feature-dev review, F-3 spurConfig (`apps/cli/src/commands/workflow.ts:253-286`), F-4 continue-drift (`workflow-service.ts:1007,1076`), F-5 fail-open proof (`packages/app/src/workflow/proof-input-fingerprint.ts:99-118`), F-6 run-id, F-7 suppressed lookup, F-8 stale expectFile, F-9 decorative binding, F-11 budget no-op, F-14 dry-run smoke; corpus regen + ADR-093 waiver migration (Decision 8); budgets FIX-not-raise (Decision 11); escalation-noise fix.

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
| R1 | MET | `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §0–§1 re-read: options A/B/C with trade-offs; A recommended; C rejected; deletion/stabilization-only (B) considered before routing; affected-ADR summaries now complete (051/071/098/099 added per prior review P3) |
| R2 | MET | Plan §2 four matrices (role×disposition, gate classes, baseline semantics, capability ownership) present, sourced from 0729 §C/§G + 0731 §2/§4; §2.2 ADR-098 row corrected to 59 packets across the 65-run sweeps |
| R3 | MET | Plan §3 seam-per-defect table; F-1 anchor re-read exact (`packages/app/src/workflow/actions/command-gate.ts:157` timeoutMs spread); budgets RED reproduced (direct run exit 1 post-bootstrap); F-11 bootstrap row marked done pre-slice; F-10 explicitly scoped out |
| R4 | MET | Plan §4 closed route table + unknown-to-safety + bounded reasons + budgets explicitly unestablished; corroborated fresh by `bun run scripts/spur-dev.ts real-run-cost --json` exit 0 (nulls null, never 0) |
| R5 | MET | Plan §5 baseline keep/simplify/replace/remove decisions + inline-driver keep with owner/parity/removal gate |
| R6 | MET | Plan §6 ADR matrix; drift claims verified fresh: `docs/03_ARCHITECTURE.md:1358` = "## 24. Production Autonomy Contracts (accepted design — ADR-094–100; not yet built)" while 0703–0712 done; `docs/00_ADR.md:2039` ADR-102 detail pointer `04 Design §agent-capability-attestation` has 0 hits in docs/04 (dangling, confirmed); mislabeled heading real at `docs/04_DESIGN.md:2436` ("Capability attestation (ADR-101, task 0706)"); 094→102 refined-by relationship now stated in the 094 row; no authority doc mutated (`git status` clean for docs/00-05) |
| R7 | MET | Plan §7 slices S0–S5, surrounding-first, task-pipeline last (S5), consent gates named; S0 surface list completed (make-lifecycle-adapter precedence unify) and escalation-noise ownership made consistent (S0) |
| R8 | MET | Plan §8 version contract; digest mechanism re-read at `packages/app/src/workflow/composition-baseline.ts:110`; both-forms execution re-proven by 0732 retained test 3/3/15 fresh |
| R9 | MET | Plan §9 self-review + D1–D8 + explicit disposition gate; premise-refresh edits from 2026-09-02 re-verify present (close-out 7c33b6d3b) |
| R10 | MET | `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` exists (366 lines, accuracy repairs applied this pass) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [non-behavior] | MET | static-ref | Plan carries input-evidence header + per-section source citations; reviewable standalone (read this run without predecessor bodies) |
| AC2 [non-behavior] | MET | static-ref | §0/§1 priority ordering (correctness → attention → tokens/PASS → wall-clock → simplicity) |
| AC3 [non-behavior] | MET | static-ref | §0/§4/§9.2: no untested control counted as effective; F-1/F-5 anchors re-verified true this run (`packages/app/src/workflow/actions/command-gate.ts:157`, `packages/app/src/workflow/proof-input-fingerprint.ts:99-118` fail-open `''` paths) |
| AC4 [non-behavior] | MET | static-ref | §3 one root-cause seam per cross-surface defect, stabilization before optimization |
| AC5 [non-behavior] | MET | static-ref | §5 five-column decisions incl. effect/parity, lifecycle, observability, rollback, sunset |
| AC6 [non-behavior] | MET | static-ref | §7 slices with dependencies/consent gates; S5 = task-pipeline LAST |
| AC7 [non-behavior] | MET | static-ref | §8 optional-first version contract: unversioned/explicit(<literal>)/empty-diagnostic + digest + pause-resume + precedence + no registry + objective evidence bar |
| AC8 [non-behavior] | MET | static-ref | §9.2/§9.3: no placeholders found this read; disposition consequences explicit; D8 closed done 2026-09-02 |
| AC9 [non-behavior] | MET | static-ref | §9.2 exclusions honored; no production/authority mutation outside the plan's own accuracy repairs |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Scope:** WBS 0733 diff (R10 durable plan deliverable) — strategy plan cross-checked against the four authority artifacts (0729 inventory, 0730 measurement, 0731 fit classification, 0732 prototype) plus live `file:line` anchors.
**Dimensions:** functional (R1-R10), correctness, architecture, evidence quality.
**Verdict:** PASS

#### Findings (ranked)

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

#### Functional Traceability (R1-R10)

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

#### Spot-check evidence (fresh, this review)

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

#### Residual Risk

- ADR-094/102 supersede-or-duplicate relationship (P3-1) and affected-ADR summary gaps (P3-2) should be resolved when S1 creates the authority/derived-doc repair tasks; neither blocks strategy approval.
- F-10 (whole-tree attribution) remains unowned by the plan — recommend an explicit in/out-of-scope line when implementation tasks are created.
- All R8/P2 claims verified against live sources; no unverified control is treated as effective (0730 §G "no budget" honored throughout).

#### Disposition

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
