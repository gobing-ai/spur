---
schema_version: 1
name: Optional DecisionMaker responder for workflow HITL
status: done
template: standard
created_at: 2026-09-20T22:27:10.101Z
updated_at: "2026-09-20T23:44:48.719Z"

feature_id: D
---

## 0910. Optional DecisionMaker responder for workflow HITL

### Background

Keep reusable decision and workflow primitives upstream while Spur owns optional operator-answer policy and evidence. Preserve existing actions and support immediate disablement when the provider is unavailable.

### Requirements

- [x] R1. Add workflow.hitlDecisionMaker boolean default false; disabled behavior uses the existing responder without constructing a model.
- [x] R2. Compose an optional application-owned DecisionMaker responder for confirm/select using bounded redacted prior action evidence; input, errors, unavailable provider, missing evidence and uncertainty delegate to the existing responder.
- [x] R3. Preserve existing action names, options, events and variables; document activation and unchanged automatic-profile routing.

### Acceptance Criteria

```gherkin
Scenario: AC-1 Legacy behavior remains default
  Given DecisionMaker is disabled
  When a operator-answer action runs
  Then the existing responder handles it without model construction
Scenario: AC-2 Optional decisions fail back safely
  Given DecisionMaker is enabled with prior action evidence
  When confirm or select receives a confident valid answer
  Then the existing action records that answer
  And uncertainty or provider failure uses the existing responder
Scenario: AC-3 Preserve the public surface
  Given an existing operator-answer workflow
  When the optional responder is composed
  Then input delegates and action events and answer variables are preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Compose at WorkflowAppService builtins registration. A separate app module wraps HitlResponder, loads bounded prior action evidence via ActionRunDao, redacts known credential patterns and configured secrets, and lazily calls upstream A2. No YAML action replacements and no changes to stock auto operator-answer routing. Existing released 0.5.0 install lacks A2; validate against sibling build and report release prerequisite. Execution budget: one bounded implementation/review pass; evidence under .spur/run/0910-*; no unrelated changes.

### Plan

1. Add config switch and optional responder with evidence projection.
2. Wire the workflow service and focused regression tests.
3. Update owning design documentation and run focused and repository gates.
4. Record verification evidence through task CLI.

### Solution

Implemented application-owned responder composition in `packages/app/src/workflow/decision-hitl-responder.ts:18` and `packages/app/src/services/workflow-service.ts:1725`. Existing runners remain unchanged. `packages/config/src/index.ts` adds the single optional switch. Evidence is bounded and redacted; provider loading is lazy; errors, uncertainty, missing evidence and input delegate. ADR-123 and the CLI design satellite define the ownership and deployment prerequisite.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:770` hitlDecisionMaker boolean optional; default-false policy test `packages/config/tests/loader.test.ts:1105` — 79 loader tests passed |
| R2 | MET | `packages/app/src/workflow/decision-hitl-responder.ts:18` composition with bounded redacted evidence, lazy provider, fallback delegation; `packages/app/tests/workflow/decision-hitl-responder.test.ts:1` — 8 tests passed; installed `@gobing-ai/ts-ai-runner` 0.5.1 exports createDecisionMaker (verified via dynamic import this run) |
| R3 | MET | `packages/app/src/services/workflow-service.ts:1724` builtins composition; action names/events/variables preserved — `packages/app/tests/services/workflow-service.test.ts:203` real-builtins test; 125 service tests passed; ADR-123 `docs/00_ADR.md:1884` + `docs/design/cli-contracts.md:782` document activation and unchanged automatic-profile routing |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC-1 Legacy behavior remains default | MET | test | `packages/app/tests/workflow/decision-hitl-responder.test.ts` disabled-identity/no-construction case; `packages/config/tests/loader.test.ts:1105` default-false — 79 pass |
| Scenario: AC-2 Optional decisions fail back safely | MET | test | `packages/app/tests/workflow/decision-hitl-responder.test.ts` unavailable/missing-key/uncertain/malformed/selection cases — 8 pass; provider export present in installed 0.5.1 |
| Scenario: AC-3 Preserve the public surface | MET | test | `packages/app/tests/services/workflow-service.test.ts:203` real service composition through builtins with stored answer variables — 125 pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — implementation review and regressions pass; upstream `@gobing-ai/ts-ai-runner` 0.5.1 installed with A2 (`createDecisionMaker`), deployment prerequisite closed.

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Prior upstream action replacement duplicated application behavior | architecture | packages/app/src/services/workflow-service.ts | P2 | FIXED: responder composition only |
| 2 | Inconsistent selected-label probabilities could steer the workflow | correctness | packages/app/src/workflow/decision-hitl-responder.ts | P2 | FIXED: exact key/finite bounds and strictly lower rival checks |
| 3 | Current installed 0.5.0 artifact predates A2 | delivery | package.json | P2 | FIXED: 0.5.1 released and installed; `createDecisionMaker` export verified live (re-verify 2026-09-20) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-20T22:28:32.838Z backlog → todo (system)
- 2026-09-20T22:28:33.132Z todo → wip (system)
- 2026-09-20T22:39:18.439Z wip → testing (system)
- 2026-09-20T23:40:26.458Z testing → done (system)

