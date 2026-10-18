---
schema_version: 1
name: Resolve operator gates as decision points under every profile
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-18T02:02:08.161Z"
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
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 137 — (pass) task 1236 R1: the interactive profile delegates every gate to the operator > an evidence gate prompts the operator and never reaches the evaluator [0.29ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 143 — (pass) task 1236 R2: profile=auto answers from the declared binding > a degrading maker applies the catalog default and the trace records the fallback [0.04ms]; fresh targeted run exited 0 |
| R3 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 145 — (pass) task 1236 R3: workflow validate requires a declared binding > rejects a confirm gate that declares no decision binding [0.12ms]; fresh targeted run exited 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — Operator gates resolve as decision points under every profile | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 137 — (pass) task 1236 R1: the interactive profile delegates every gate to the operator > an evidence gate prompts the operator and never reaches the evaluator [0.29ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 143 — (pass) task 1236 R2: profile=auto answers from the declared binding > a degrading maker applies the catalog default and the trace records the fallback [0.04ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 145 — (pass) task 1236 R3: workflow validate requires a declared binding > rejects a confirm gate that declares no decision binding [0.12ms]; fresh targeted run exited 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 137 — (pass) task 1236 R1: the interactive profile delegates every gate to the operator > an evidence gate prompts the operator and never reaches the evaluator [0.29ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 143 — (pass) task 1236 R2: profile=auto answers from the declared binding > a degrading maker applies the catalog default and the trace records the fallback [0.04ms]; fresh targeted run exited 0 |
| R3 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 145 — (pass) task 1236 R3: workflow validate requires a declared binding > rejects a confirm gate that declares no decision binding [0.12ms]; fresh targeted run exited 0 |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R5 — Operator gates resolve as decision points under every profile | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 137 — (pass) task 1236 R1: the interactive profile delegates every gate to the operator > an evidence gate prompts the operator and never reaches the evaluator [0.29ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 143 — (pass) task 1236 R2: profile=auto answers from the declared binding > a degrading maker applies the catalog default and the trace records the fallback [0.04ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 145 — (pass) task 1236 R3: workflow validate requires a declared binding > rejects a confirm gate that declares no decision binding [0.12ms]; fresh targeted run exited 0 |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T19:07:35.875Z todo → wip (system)
- 2026-10-17T19:07:36.623Z wip → testing (system)
- 2026-10-17T19:07:41.596Z testing → done (system)

