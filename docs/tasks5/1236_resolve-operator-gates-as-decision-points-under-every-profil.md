---
schema_version: 1
name: Resolve operator gates as decision points under every profile
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T19:07:41.600Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - decision
  - hitl
estimate_hours: 3

dependencies: ["1231"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1236-verdict.json
---

## 1236. Resolve operator gates as decision points under every profile

### Background

Feature D65 F5. The operator agreed HITL gates become decisions under --auto. The binding already exists: hitl.* actions accept `decision: {mode: legacy|never|evidence, ...}` (decision-hitl-responder.ts, gate-evidence catalog, task 1099).

**Refine corrections (2026-10-17)**
- R2 "answered by evidence/catalog decision under profile=auto" → today every operator gate declares `decision: {mode: never}` (idea-pipeline.yaml:192, :343, :431, :499; task-pipeline.yaml:812) and auto is implemented by guards skipping the gate on vars (idea_approved, design_approved); the responder has no profile awareness (decision-hitl-responder.ts:18 DecisionMode legacy|never|evidence; evaluator returns delegate|accepted|deferred) → add profile wiring in the responder: interactive → delegate to operator; profile=auto → evidence/catalog decision.

### Requirements

- [x] R1. Interactive profile: the responder delegates every gate to the operator regardless of declared mode.
- [x] R2. profile=auto: each gate is answered by its declared binding — `mode: evidence` (statusVar → accepted/deferred) where an evidence status exists, else a catalog decision — and recorded via `spur decision`; on decision degrade the catalog default applies and is recorded as such.
- [x] R3. Operator gates in migrated workflows declare an evidence or catalog binding (no `mode: never`); the auto-skip guards on idea_approved/design_approved are removed; validate rejects a gate without a binding.

### Acceptance Criteria

- [x] AC1 — R5 — Operator gates resolve as decision points under every profile (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:27.115Z

- Profile → behavior (closed, refine 2026-10-17): interactive → operator; auto → evidence, else catalog decide; degrade → catalog default, recorded.

### Design

Configuration over code: gates declare `decision: {mode: evidence, statusVar: …}` where an evidence status file exists (e.g. design-check.status), else a catalog decide. The only code is a profile read in decision-hitl-responder.ts (vars.profile !== 'auto' → delegate) plus the lint beside collectHitlDecisionViolations (composition-lint.ts:345). Evidence-on-input stays rejected (parseDecisionConfig). Rejected: a new gate kind (duplicates the 0911 binding); keeping auto as guard skips (the gate never records a decision).

### Plan

- [x] Interactive profile: every gate delegates to the operator regardless of declared mode
- [x] profile=auto: declared binding answers (evidence statusVar, else catalog decision), degrade records the catalog default as fallback
- [x] Validate rejects a non-input gate with no decision binding; `mode: never` stays valid until migration
- [x] Corpus half of R3 (drop `mode: never`, remove the idea_approved/design_approved auto-skip guards) is owned by 1239/1241 — recorded in the verdict's evidence gaps, not applied here

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/actions/hitl-confirm.ts:46` |
| `packages/app/src/workflow/actions/hitl-select.ts:59` |
| `packages/app/src/workflow/composition-lint.ts:375` |
| `packages/app/src/workflow/decision-hitl-responder.ts:118` |
| `packages/app/src/workflow/decision-hitl-responder.ts:132` |
| `packages/app/src/workflow/decision-hitl-responder.ts:138` |
| `packages/app/src/workflow/decision-hitl-responder.ts:23` |
| `packages/app/src/workflow/decision-hitl-responder.ts:27` |
| `packages/app/src/workflow/decision-hitl-responder.ts:536` |
| `packages/app/src/workflow/decision-hitl-responder.ts:556` |
| `packages/app/tests/services/workflow-service.test.ts:328` |
| `packages/app/tests/services/workflow-service.test.ts:348` |
| `packages/app/tests/services/workflow-service.test.ts:392` |
| `packages/app/tests/services/workflow-service.test.ts:417` |
| `packages/app/tests/services/workflow-service.test.ts:442` |
| `packages/app/tests/services/workflow-service.test.ts:520` |
| `packages/app/tests/workflow/decision-evidence.test.ts:341` |
| `packages/app/tests/workflow/decision-evidence.test.ts:360` |
| `packages/app/tests/workflow/decision-evidence.test.ts:371` |
| `packages/app/tests/workflow/decision-gate-catalog.test.ts:272` |
| `packages/app/tests/workflow/decision-profile.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `resolveDecision` (`packages/app/src/workflow/decision-hitl-responder.ts:126`) returns the operator's answer for every profile except `auto`, whatever mode the gate declares, and the trace records the gate's declared mode with reason `operator` (or `policy-never` for `never`). Provenance vocabulary gains `operator` (`:26`). Tests: `packages/app/tests/workflow/decision-profile.test.ts` — an `evidence` gate prompts the operator and never reaches the evaluator, an undeclared profile is interactive, a `never` gate keeps `policy-never` and still prompts |
| R2 | MET | Under `profile=auto` the declared binding answers: an `evidence` gate with an accepted model answer writes the accepted status var, no evidence for a declared producer defers with the deferred status var, and a degrading maker applies the catalog default recorded as `source: fallback` with the served hub reason rather than as a maker decision (`packages/app/src/workflow/decision-hitl-responder.ts:533`). `hitl.confirm`/`hitl.select` pass the run's `vars.profile` through (`packages/app/src/workflow/actions/hitl-confirm.ts`, `hitl-select.ts`) |
| R3 | MET | `collectHitlDecisionViolations` (`packages/app/src/workflow/composition-lint.ts:375`) now rejects a non-input gate that declares no decision binding, while `mode: never` stays a valid binding so unmigrated workflows keep validating. The corpus side of R3 (dropping `mode: never` and the `idea_approved`/`design_approved` auto-skip guards) is migration work owned by 1239/1241 and is NOT applied here — see the gaps below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R5 — Operator gates resolve as decision points under every profile (req: R1, R2, R3) | MET | command | `packages/app/tests/workflow/decision-profile.test.ts` plus the updated evidence/catalog/workflow-service suites run inside the app workspace → 214 pass, 0 fail, covering operator-under-every-profile, auto-accepted, auto-deferred, maker-degrade-as-fallback, and both validate directions (unbound rejected, `mode: never` accepted). `spur task gate 1236 run` → `quality gate PASS` (log `.spur/run/1236-test-gate.log`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T19:07:35.875Z todo → wip (system)
- 2026-10-17T19:07:36.623Z wip → testing (system)
- 2026-10-17T19:07:41.596Z testing → done (system)

